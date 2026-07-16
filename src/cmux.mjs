// Thin wrapper around the cmux control CLI. Best-effort: every call degrades
// gracefully when cmux isn't running or the socket isn't open to us.
import { execFile } from 'node:child_process';
import fs from 'node:fs';

// launchd gives us a bare PATH — find the binary ourselves.
const CMUX = ['/usr/local/bin/cmux', '/opt/homebrew/bin/cmux'].find(p => fs.existsSync(p)) || 'cmux';

function run(args, timeout = 8000) {
  return new Promise((resolve) => {
    execFile(CMUX, args, { timeout }, (err, stdout) => {
      resolve(err ? null : stdout.trim());
    });
  });
}

const BUNDLE = 'com.cmuxterm.app';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function cmuxUp() {
  return (await run(['ping'], 2000)) === 'PONG';
}

// Make sure cmux is running and answering — launch the app if needed.
// Returns { up, started, reason }.
export async function ensureCmux() {
  if (await cmuxUp()) return { up: true, started: false };
  const opened = await new Promise(r => execFile('open', ['-b', BUNDLE], (err) => r(!err)));
  if (!opened) return { up: false, reason: 'cmux.app not found' };
  for (let i = 0; i < 25; i++) {
    await sleep(600);
    if (await cmuxUp()) return { up: true, started: true };
  }
  return { up: false, reason: 'cmux launched but its control socket is not answering (Settings → Advanced → Automation socket)' };
}

// Bring the cmux app to the foreground so the user actually sees the result.
export function frontCmux() {
  execFile('open', ['-b', BUNDLE], () => {});
}

// Read the visible contents of a session's cmux pane (best-effort, no launch).
export async function readScreen(loc, lines = 45) {
  if (!loc?.workspace_uuid) return null;
  const args = ['read-screen', '--workspace', loc.workspace_uuid, '--lines', String(lines)];
  if (loc.surface_uuid) args.splice(2, 0, '--surface', loc.surface_uuid);
  return run(args, 4000);
}

// Focus a known workspace/surface (from hook-captured identify data).
// Prefer UUIDs: short refs like "workspace:2" are reused after closes and can
// silently focus the wrong workspace.
export async function focusPane(loc) {
  if (!loc) return false;
  const ws = loc.workspace_uuid; // refs are recycled after closes — UUID or nothing
  if (!ws) return false;
  const ok = await run(['select-workspace', '--workspace', ws]);
  if (ok === null) return false;
  if (loc.pane_uuid) await run(['focus-pane', '--pane', loc.pane_uuid, '--workspace', ws]);
  await run(['trigger-flash', '--workspace', ws, ...(loc.surface_uuid ? ['--surface', loc.surface_uuid] : [])]);
  return true;
}

// Open a new cmux workspace, cd into the project, and run a command
// (resume a session, or start a fresh wish). Mirrors the proven rig.sh flow.
export async function openWorkspace(title, cwd, command) {
  const created = await run(['new-workspace']);
  if (created === null) return null;
  const ws = (created.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i) || created.match(/workspace:\d+/) || [])[0];
  if (!ws) return null;
  if (title) await run(['rename-workspace', '--workspace', ws, title.slice(0, 40)]);
  const surfaces = await run(['--json', 'list-pane-surfaces', '--workspace', ws]);
  const surf = (surfaces?.match(/surface:\d+/) || [])[0];
  if (surf) {
    await run(['send', '--workspace', ws, '--surface', surf, `cd ${shq(cwd || '~')} && ${command}`]);
    await run(['send-key', '--workspace', ws, '--surface', surf, 'enter']);
  }
  await run(['select-workspace', '--workspace', ws]);
  return ws;
}

export function shq(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}
