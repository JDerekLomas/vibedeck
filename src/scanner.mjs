// Watches ~/.claude/projects/**/*.jsonl and maintains an in-memory picture of
// every session: who it belongs to, what was asked, recent exchanges, activity.
//
// Two tiers to stay cheap over multi-GB history:
//   - ACTIVE (mtime within ACTIVE_WINDOW): streamed fully, then tailed incrementally.
//   - ARCHIVE (older, within ARCHIVE_WINDOW): head+tail sample only — enough for a card.
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PROJECTS_DIR } from './store.mjs';

export const ACTIVE_WINDOW = 48 * 3600e3;
export const ARCHIVE_WINDOW = 21 * 24 * 3600e3;
const RECENT_KEEP = 40;
const SNIPPET_LEN = 700;

const textOf = (content) => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter(p => p && p.type === 'text' && typeof p.text === 'string').map(p => p.text).join('\n');
  }
  return '';
};

function prettyProject(dirName, cwd) {
  if (cwd) {
    const parts = cwd.split('/').filter(Boolean);
    const i = parts.indexOf('dereklomas');
    return parts.slice(i + 1).join('/') || '~';
  }
  return dirName.replace(/^-Users-dereklomas-?/, '') || '~';
}

function newSession(id, file, dirName) {
  return {
    id, file, dirName,
    project: prettyProject(dirName, null),
    cwd: null, gitBranch: null,
    firstPrompt: null, wish: null, lastPrompt: null, aiTitle: null,
    userCount: 0, assistantCount: 0, toolCount: 0,
    recent: [],            // [{role, text, ts}]
    lastActivity: 0,       // ms epoch of last message
    mtime: 0, size: 0,
    tier: 'archive',       // 'active' | 'archive'
    parsed: false,
  };
}

export class Scanner extends EventEmitter {
  constructor() {
    super();
    this.sessions = new Map();   // id -> session
    this.offsets = new Map();    // file -> {offset, leftover}
    this.pending = new Map();    // debounce timers per file
  }

  async init() {
    const dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true }).filter(d => d.isDirectory());
    const now = Date.now();
    const jobs = [];
    for (const dir of dirs) {
      const dp = path.join(PROJECTS_DIR, dir.name);
      let files;
      try { files = fs.readdirSync(dp); } catch { continue; }
      for (const f of files) {
        if (!f.endsWith('.jsonl')) continue;
        const fp = path.join(dp, f);
        let st;
        try { st = fs.statSync(fp); } catch { continue; }
        if (now - st.mtimeMs > ARCHIVE_WINDOW) continue;
        const id = f.replace(/\.jsonl$/, '');
        const s = newSession(id, fp, dir.name);
        s.mtime = st.mtimeMs; s.size = st.size;
        s.tier = (now - st.mtimeMs <= ACTIVE_WINDOW) ? 'active' : 'archive';
        this.sessions.set(id, s);
        jobs.push(s.tier === 'active' ? () => this.fullParse(s) : () => this.sampleParse(s));
      }
    }
    // Parse newest first so the board fills with what matters.
    const bySession = [...this.sessions.values()].sort((a, b) => b.mtime - a.mtime);
    for (const s of bySession) {
      try { s.tier === 'active' ? await this.fullParse(s) : this.sampleParse(s); }
      catch (e) { console.error('parse', s.id, e.message); }
    }
    void jobs;
    this.watch();
  }

  watch() {
    try {
      fs.watch(PROJECTS_DIR, { recursive: true }, (ev, rel) => {
        if (!rel || !rel.endsWith('.jsonl')) return;
        const fp = path.join(PROJECTS_DIR, rel);
        clearTimeout(this.pending.get(fp));
        this.pending.set(fp, setTimeout(() => { this.pending.delete(fp); this.onFileChange(fp, rel); }, 400));
      });
    } catch (e) { console.error('watch failed', e.message); }
  }

  onFileChange(fp, rel) {
    let st;
    try { st = fs.statSync(fp); } catch { return; }
    const dirName = rel.split(path.sep)[0];
    const id = path.basename(fp, '.jsonl');
    let s = this.sessions.get(id);
    if (!s) {
      s = newSession(id, fp, dirName);
      this.sessions.set(id, s);
    }
    s.mtime = st.mtimeMs; s.size = st.size; s.tier = 'active';
    const known = this.offsets.get(fp);
    const run = known ? this.parseFrom(s, known.offset) : this.fullParse(s);
    run.then(() => this.emit('change', id)).catch(e => console.error('incr parse', id, e.message));
  }

  fullParse(s) {
    this.offsets.set(s.file, { offset: 0 });
    return this.parseFrom(s, 0);
  }

  parseFrom(s, offset) {
    return new Promise((resolve, reject) => {
      let st;
      try { st = fs.statSync(s.file); } catch { return resolve(); }
      if (st.size <= offset) return resolve();
      const stream = fs.createReadStream(s.file, { start: offset, encoding: 'utf8' });
      let buf = '';
      let consumed = offset;
      stream.on('data', chunk => {
        buf += chunk;
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          consumed += Buffer.byteLength(line, 'utf8') + 1;
          this.ingestLine(s, line);
        }
      });
      stream.on('end', () => {
        this.offsets.set(s.file, { offset: consumed });
        s.parsed = true;
        resolve();
      });
      stream.on('error', reject);
    });
  }

  // Archive tier: first 32KB (the wish) + last 96KB (title, last activity). No full read.
  sampleParse(s) {
    let fd;
    try { fd = fs.openSync(s.file, 'r'); } catch { return; }
    try {
      const headLen = Math.min(32768, s.size);
      const head = Buffer.alloc(headLen);
      fs.readSync(fd, head, 0, headLen, 0);
      for (const line of head.toString('utf8').split('\n')) this.ingestLine(s, line, { sample: true });

      if (s.size > headLen) {
        const tailLen = Math.min(98304, s.size - headLen);
        const tail = Buffer.alloc(tailLen);
        fs.readSync(fd, tail, 0, tailLen, s.size - tailLen);
        const lines = tail.toString('utf8').split('\n').slice(1); // drop partial first line
        for (const line of lines) this.ingestLine(s, line, { sample: true });
      }
      s.parsed = true;
    } finally { fs.closeSync(fd); }
  }

  ingestLine(s, line, opts = {}) {
    if (!line || line.length > 2_000_000) return;
    let d;
    try { d = JSON.parse(line); } catch { return; }
    const ts = d.timestamp ? Date.parse(d.timestamp) : 0;
    if (ts > s.lastActivity) s.lastActivity = ts;

    switch (d.type) {
      case 'user': {
        if (d.isSidechain) return;
        if (!s.cwd && d.cwd) { s.cwd = d.cwd; s.project = prettyProject(s.dirName, d.cwd); }
        if (d.gitBranch) s.gitBranch = d.gitBranch;
        const text = textOf(d.message?.content).trim();
        if (!text) return;
        // System-injected user turns (task notifications, command output, reminders)
        // must never masquerade as Derek's words.
        const systemish = /^(<local-command|<command-name>|<task-notification|<system-reminder|\[SYSTEM|Caveat:)/.test(text);
        if (systemish) return;
        const human = (d.origin?.kind === 'human' || d.promptSource) && !text.startsWith('<');
        // Skip tool_result-only user entries (no text extracted above).
        s.userCount++;
        if (human && !s.firstPrompt) s.firstPrompt = text.slice(0, 2000);
        // "continue" / "yes" resumptions make a poor wish — prefer the first real ask.
        if (human && !s.wish && text.length >= 40) s.wish = text.slice(0, 2000);
        if (human) s.lastPrompt = text.slice(0, 2000);
        this.pushRecent(s, 'user', text, ts, opts);
        break;
      }
      case 'assistant': {
        if (d.isSidechain) return;
        const content = d.message?.content;
        if (Array.isArray(content)) {
          for (const p of content) if (p?.type === 'tool_use') s.toolCount++;
        }
        const text = textOf(content).trim();
        s.assistantCount++;
        if (text) this.pushRecent(s, 'assistant', text, ts, opts);
        break;
      }
      case 'ai-title':
        if (d.aiTitle) s.aiTitle = d.aiTitle;
        break;
      case 'summary':
        if (d.summary && !s.aiTitle) s.aiTitle = d.summary;
        break;
      default: break;
    }
  }

  pushRecent(s, role, text, ts, opts) {
    s.recent.push({ role, text: text.slice(0, SNIPPET_LEN), ts });
    const keep = opts.sample ? 12 : RECENT_KEEP;
    if (s.recent.length > keep) s.recent.splice(0, s.recent.length - keep);
  }
}
