// Data dir, env loading, and per-session persistent cache (brain results, art history).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const DATA_DIR = path.join(os.homedir(), '.vibedeck');
export const SESS_DIR = path.join(DATA_DIR, 'data');
export const ART_DIR = path.join(DATA_DIR, 'art');
export const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
export const PORT = Number(process.env.VIBEDECK_PORT || 8423);

for (const d of [DATA_DIR, SESS_DIR, ART_DIR]) fs.mkdirSync(d, { recursive: true });

// Load KEY=VALUE lines from ~/.vibedeck/env into process.env (existing env wins).
export function loadEnv() {
  const f = path.join(DATA_DIR, 'env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const val = m[2].replace(/^["']|["']$/g, '');
    if (val && !process.env[m[1]]) process.env[m[1]] = val;
  }
}

const cacheFile = (id) => path.join(SESS_DIR, `${id}.json`);

export function readCache(id) {
  try { return JSON.parse(fs.readFileSync(cacheFile(id), 'utf8')); } catch { return null; }
}

export function writeCache(id, obj) {
  try { fs.writeFileSync(cacheFile(id), JSON.stringify(obj)); } catch (e) { console.error('cache write', id, e.message); }
}

export function artDirFor(id) {
  const d = path.join(ART_DIR, id);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function listArt(id) {
  const d = path.join(ART_DIR, id);
  try {
    return fs.readdirSync(d)
      .filter(f => /\.(png|svg|jpg)$/.test(f))
      .sort()
      .map(f => ({ url: `/art/${id}/${f}`, ts: Number(f.split('.')[0]) || 0 }));
  } catch { return []; }
}
