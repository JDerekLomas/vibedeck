// vibedeck server — the attention board for parallel Claude Code sessions.
// Zero dependencies: http + SSE + fs.watch. Runs on 127.0.0.1 only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, readCache, writeCache, listArt, ART_DIR, DATA_DIR, PORT } from './store.mjs';
import { Scanner, ACTIVE_WINDOW } from './scanner.mjs';
import { generateBrain } from './brain.mjs';
import { saveGlyph } from './art.mjs';
import { WebSocketServer } from 'ws';
import { ensureCmux, focusPane, frontCmux, openWorkspace, readScreen, shq } from './cmux.mjs';
import { attach, bindTerm, boundTerm, startTerm, startWish, termRunning } from './term.mjs';

loadEnv();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');
const scanner = new Scanner();
const hookState = new Map();   // sessionId -> {state, detail, ts, loc}
const brainMeta = new Map();   // sessionId -> {brain, dirtyEvent, artDay, artCount, generating}
const sseClients = new Set();

// ---------- persistence ----------
function metaFor(id) {
  let m = brainMeta.get(id);
  if (!m) {
    const cached = readCache(id) || {};
    m = { brain: cached.brain || null, dirtyEvent: false, artDay: cached.artDay || '', artCount: cached.artCount || 0, generating: false, artBusy: false };
    if (cached.hook && !hookState.has(id)) hookState.set(id, cached.hook);
    if (cached.term) bindTerm(id, cached.term);
    brainMeta.set(id, m);
  }
  return m;
}
function persist(id) {
  const m = brainMeta.get(id);
  if (!m) return;
  writeCache(id, { brain: m.brain, artDay: m.artDay, artCount: m.artCount, hook: hookState.get(id) || null, term: boundTerm(id) });
}

// ---------- state ----------
function stateOf(s) {
  const h = hookState.get(s.id);
  const now = Date.now();
  if (h && h.ts >= s.mtime - 5000) {
    if (h.state === 'working' && now - h.ts > 30 * 60e3 && now - s.mtime > 30 * 60e3) return { state: 'idle', detail: null };
    return { state: h.state, detail: h.detail || null };
  }
  // File is being written to right now -> the agent is working.
  if (now - s.mtime < 3 * 60e3) return { state: 'working', detail: null };
  if (h) return { state: h.state === 'working' ? 'idle' : h.state, detail: h.detail || null };
  return { state: 'idle', detail: null };
}

function card(s) {
  const m = metaFor(s.id);
  const art = listArt(s.id);
  const st = stateOf(s);
  const title = m.brain?.title || s.aiTitle || (s.firstPrompt ? s.firstPrompt.slice(0, 60) : s.project);
  return {
    id: s.id,
    project: s.project,
    branch: s.gitBranch,
    cwd: s.cwd,
    title,
    status: m.brain?.status || null,
    asks: st.state === 'needs-input' ? (st.detail || m.brain?.asks || 'waiting on you') : m.brain?.asks || null,
    emoji: m.brain?.emoji || null,
    state: st.state,
    stateDetail: st.detail,
    lastActivity: s.lastActivity || s.mtime,
    stateSince: hookState.get(s.id)?.ts || s.mtime,
    art: art.length ? art[art.length - 1].url : null,
    artCount: art.length,
    msgs: s.userCount + s.assistantCount,
    tools: s.toolCount,
  };
}

function board() {
  const now = Date.now();
  const all = [...scanner.sessions.values()].filter(s => s.parsed && (s.userCount > 0 || s.firstPrompt));
  const active = [], earlier = [];
  for (const s of all) (now - (s.lastActivity || s.mtime) <= ACTIVE_WINDOW ? active : earlier).push(s);
  const rank = { 'needs-input': 0, working: 1, idle: 2, ended: 3 };
  const cards = active.map(card).sort((a, b) =>
    (rank[a.state] ?? 9) - (rank[b.state] ?? 9) ||
    (a.state === 'needs-input' ? a.stateSince - b.stateSince : b.lastActivity - a.lastActivity));
  const earlierCards = earlier.map(card).sort((a, b) => b.lastActivity - a.lastActivity).slice(0, 120);
  return { generatedAt: now, active: cards, earlier: earlierCards };
}

// ---------- SSE ----------
let broadcastTimer = null;
function broadcast() {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    const msg = `data: refresh\n\n`;
    for (const res of sseClients) { try { res.write(msg); } catch { sseClients.delete(res); } }
  }, 700);
}
scanner.on('change', broadcast);

// ---------- hook events ----------
function onHookEvent(payload, cmuxIdent, termName) {
  const id = payload.session_id;
  if (!id) return;
  if (termName) bindTerm(id, termName);
  const ev = payload.hook_event_name;
  const map = {
    UserPromptSubmit: 'working',
    PreToolUse: 'working',
    Stop: 'idle',
    SubagentStop: null,
    Notification: 'needs-input',
    SessionStart: 'idle',
    SessionEnd: 'ended',
  };
  const state = map[ev];
  if (state === undefined || state === null) return;
  const prev = hookState.get(id) || {};
  const caller = cmuxIdent?.caller;
  const loc = (caller?.workspace_id || caller?.workspace_ref) ? {
    workspace_uuid: caller.workspace_id || null,
    workspace_ref: caller.workspace_ref || null,
    pane_uuid: caller.pane_id || null,
    surface_uuid: caller.surface_id || null,
    surface_ref: caller.surface_ref || null,
  } : prev.loc || null;
  hookState.set(id, { state, detail: ev === 'Notification' ? (payload.message || null) : null, ts: Date.now(), loc });
  const m = metaFor(id);
  if (ev === 'Stop' || ev === 'Notification') m.dirtyEvent = true;
  persist(id);
  try { fs.appendFileSync(path.join(DATA_DIR, 'events.log'), JSON.stringify({ t: new Date().toISOString(), ev, id: id.slice(0, 8), cwd: payload.cwd }) + '\n'); } catch {}
  broadcast();
}

// ---------- brain + art loops ----------
let brainBusy = 0;
async function brainTick() {
  const now = Date.now();
  const candidates = [...scanner.sessions.values()]
    .filter(s => s.parsed && s.userCount > 0 && now - (s.lastActivity || s.mtime) <= ACTIVE_WINDOW)
    .sort((a, b) => (b.lastActivity || b.mtime) - (a.lastActivity || a.mtime))
    .slice(0, 30);
  for (const s of candidates) {
    if (brainBusy >= 2) break;
    const m = metaFor(s.id);
    if (m.generating) continue;
    const msgs = s.userCount + s.assistantCount;
    const stale = !m.brain || !m.brain.svg || (msgs - (m.brain.atMsgCount || 0) >= 6) || m.dirtyEvent;
    const cooled = now - (m.brain?.genAt || 0) > 90e3;
    if (!stale || !cooled) continue;
    m.generating = true; brainBusy++;
    const hint = stateOf(s).state;
    const prevSvg = m.brain?.svg || null;
    generateBrain(s, m.brain, hint)
      .then(brain => {
        if (brain) {
          m.brain = brain; m.dirtyEvent = false;
          // Persist a glyph when the session gets its first one, or whenever
          // the drawing actually changed (the brain keeps good glyphs verbatim,
          // so changed bytes mean a genuine redraw). History feeds the filmstrip.
          const hasGlyph = listArt(s.id).some(a => a.url.endsWith('.svg'));
          if (!hasGlyph || (brain.svg && brain.svg !== prevSvg)) saveGlyph(s, brain.svg);
          persist(s.id); broadcast();
        }
      })
      .catch(e => console.error('brain', s.id.slice(0, 8), e.message))
      .finally(() => { m.generating = false; brainBusy--; });
  }
}

// ---------- http ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', c => { buf += c; if (buf.length > 2e6) req.destroy(); });
    req.on('end', () => { try { resolve(buf ? JSON.parse(buf) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/api/event' && req.method === 'POST') {
      const body = await readBody(req).catch(() => null);
      if (body) onHookEvent(body.payload || body, body.cmux || null, body.term || null);
      return send(res, 204, '');
    }
    if (p === '/api/sessions') return send(res, 200, board());
    if (p.startsWith('/api/session/')) {
      const id = p.split('/')[3];
      const s = scanner.sessions.get(id);
      if (!s) return send(res, 404, { error: 'unknown session' });
      return send(res, 200, {
        ...card(s),
        firstPrompt: s.wish || s.firstPrompt,
        lastPrompt: s.lastPrompt,
        recent: s.recent.slice(-8),
        artHistory: listArt(id),
        file: s.file,
        term: await termRunning(id),
        cmuxPane: !!hookState.get(id)?.loc?.workspace_uuid,
        resumeCmd: `cd ${shq(s.cwd || '~')} && claude --resume ${id}`,
      });
    }
    if (p === '/api/open' && req.method === 'POST') {
      const { id } = await readBody(req);
      const s = scanner.sessions.get(id);
      if (!s) return send(res, 404, { error: 'unknown session' });
      const resumeCmd = `cd ${shq(s.cwd || '~')} && claude --resume ${id}`;
      const cm = await ensureCmux();
      if (!cm.up) return send(res, 200, { result: 'no-cmux', detail: cm.reason, resumeCmd });
      const loc = hookState.get(id)?.loc;
      const st = stateOf(s).state;
      if (loc && st !== 'ended' && (await focusPane(loc))) { frontCmux(); return send(res, 200, { result: 'focused' }); }
      const m = metaFor(id);
      const ws = await openWorkspace(m.brain?.title || s.project, s.cwd, `claude --resume ${id}`);
      if (ws) frontCmux();
      return send(res, 200, ws ? { result: 'resumed', workspace: ws } : { result: 'failed', detail: 'cmux answered ping but workspace creation failed', resumeCmd });
    }
    if (p === '/api/wish' && req.method === 'POST') {
      const { cwd, text } = await readBody(req);
      if (!text) return send(res, 400, { error: 'no wish' });
      const name = await startWish(cwd, text);
      if (name) return send(res, 200, { result: 'started', term: name });
      return send(res, 200, { result: 'failed', detail: 'tmux could not start the session', cmd: `cd ${shq(cwd || '~')} && claude ${shq(text)}` });
    }
    if (p.startsWith('/api/term/') && req.method === 'POST') {
      const id = p.split('/')[3];
      const s = scanner.sessions.get(id);
      if (!s) return send(res, 404, { error: 'unknown session' });
      const name = await startTerm(s);
      return send(res, 200, name ? { ok: true, term: name } : { ok: false, detail: 'tmux could not start' });
    }
    if (p === '/api/projects') {
      const seen = new Map();
      for (const s of scanner.sessions.values()) {
        if (s.cwd) seen.set(s.cwd, Math.max(seen.get(s.cwd) || 0, s.lastActivity || s.mtime));
      }
      return send(res, 200, [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([cwd]) => cwd).slice(0, 40));
    }
    if (p.startsWith('/api/screen/')) {
      const id = p.split('/')[3];
      const loc = hookState.get(id)?.loc;
      if (!loc?.workspace_uuid) return send(res, 200, { text: null, reason: 'no cmux pane on record' });
      const text = await readScreen(loc);
      return send(res, 200, text === null ? { text: null, reason: 'cmux not answering' } : { text });
    }
    if (p === '/api/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write('data: hello\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }
    if (p.startsWith('/art/')) {
      const rel = path.normalize(p.slice(5));
      if (rel.startsWith('..')) return send(res, 403, { error: 'no' });
      const f = path.join(ART_DIR, rel);
      if (!fs.existsSync(f)) return send(res, 404, { error: 'not found' });
      return send(res, 200, fs.readFileSync(f), MIME[path.extname(f)] || 'application/octet-stream');
    }
    // static
    const rel = p === '/' ? '/index.html' : path.normalize(p);
    if (rel.startsWith('..')) return send(res, 403, { error: 'no' });
    const f = path.join(PUBLIC, rel);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) return send(res, 200, fs.readFileSync(f), MIME[path.extname(f)] || 'text/plain');
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(req.method, p, e.message);
    return send(res, 500, { error: e.message });
  }
});

// ---------- terminal websocket ----------
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const m = req.url.match(/^\/term\/([0-9a-f-]{36})$/);
  if (!m) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => attach(ws, m[1]));
});

console.log('vibedeck: scanning sessions…');
await scanner.init();
console.log(`vibedeck: ${scanner.sessions.size} sessions loaded`);
setInterval(brainTick, 15e3);
brainTick();
server.listen(PORT, '127.0.0.1', () => console.log(`vibedeck: http://127.0.0.1:${PORT}`));
