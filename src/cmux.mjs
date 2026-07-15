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

export async function cmuxUp() {
  return (await run(['ping'], 2000)) === 'PONG';
}

// Focus a known workspace/surface (from hook-captured identify data).
export async function focusPane(loc) {
  if (!loc) return false;
  const ws = loc.workspace_ref || loc.workspace;
  if (!ws) return false;
  const ok = await run(['select-workspace', '--workspace', ws]);
  const surf = loc.surface_ref || loc.surface;
  if (surf) await run(['focus-pane', '--pane', surf.replace('surface', 'pane'), '--workspace', ws]);
  await run(['trigger-flash', '--workspace', ws, ...(surf ? ['--surface', surf] : [])]);
  return ok !== null;
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
