// In-app terminals: sessions run inside headless tmux (survives vibedeck
// restarts); the browser attaches through a node-pty <-> WebSocket bridge.
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { spawn as ptySpawn } from 'node-pty';
import { shq } from './cmux.mjs';

const TMUX = ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux'].find(p => fs.existsSync(p)) || 'tmux';
// launchd gives us a bare PATH — resolve claude ourselves.
const CLAUDE = [
  `${process.env.HOME}/.local/bin/claude`,
  '/opt/homebrew/bin/claude',
  '/usr/local/bin/claude',
].find(p => fs.existsSync(p)) || 'claude';

export const tmuxName = (id) => 'vd-' + id.slice(0, 8);

function tmuxRun(args) {
  return new Promise(res => execFile(TMUX, args, { timeout: 8000 }, (e, so) => res(e ? null : (so ?? '').trim())));
}

// termNames: sessionId -> tmux session name (hook-reported for wish sessions).
const termNames = new Map();
export function bindTerm(sessionId, name) { if (name) termNames.set(sessionId, name); }
export function boundTerm(sessionId) { return termNames.get(sessionId) || null; }
export function termNameFor(sessionId) { return termNames.get(sessionId) || tmuxName(sessionId); }

export async function termRunning(sessionId) {
  return (await tmuxRun(['has-session', '-t', termNameFor(sessionId)])) !== null;
}

async function newTmux(name, cwd, command) {
  const r = await tmuxRun([
    'new-session', '-d', '-s', name, '-c', cwd || process.env.HOME,
    '-x', '220', '-y', '50', '-e', `VIBEDECK_TERM=${name}`,
    command,
  ]);
  if (r === null) return null;
  await tmuxRun(['set-option', '-t', name, 'status', 'off']);
  await tmuxRun(['set-option', '-t', name, 'history-limit', '20000']);
  await tmuxRun(['set-option', '-t', name, 'window-size', 'latest']);
  // When claude exits, keep the shell so the pane doesn't vanish mid-read.
  await tmuxRun(['set-option', '-t', name, 'remain-on-exit', 'off']);
  return name;
}

// Resume an existing session in its own tmux.
export async function startTerm(session) {
  const name = termNameFor(session.id);
  if (await termRunning(session.id)) return name;
  return newTmux(name, session.cwd, `${CLAUDE} --resume ${session.id}`);
}

// Birth a new session from a wish.
export async function startWish(cwd, text) {
  const name = `vd-wish-${Math.random().toString(36).slice(2, 8)}`;
  return newTmux(name, cwd, `${CLAUDE} ${shq(text)}`);
}

// Bridge one WebSocket client to a tmux attach running in a PTY.
export function attach(ws, sessionId) {
  const name = termNameFor(sessionId);
  let pty;
  try {
    pty = ptySpawn(TMUX, ['attach', '-t', name], {
      name: 'xterm-256color', cols: 220, rows: 50,
      cwd: process.env.HOME,
      env: { ...process.env, TERM: 'xterm-256color' },
    });
  } catch (e) {
    ws.close(1011, e.message);
    return;
  }
  pty.onData(d => { if (ws.readyState === 1) ws.send(d); });
  pty.onExit(() => { try { ws.close(); } catch {} });
  ws.on('message', (m) => {
    try {
      const msg = JSON.parse(m.toString());
      if (msg.type === 'input') pty.write(msg.data);
      else if (msg.type === 'resize' && msg.cols > 10 && msg.rows > 4) pty.resize(msg.cols, msg.rows);
    } catch {}
  });
  ws.on('close', () => { try { pty.kill(); } catch {} });
}
