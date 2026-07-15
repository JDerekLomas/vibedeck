// Merge vibedeck's event hook into ~/.claude/settings.json (idempotent, with backup).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
const emit = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'emit.sh');
const EVENTS = ['UserPromptSubmit', 'Stop', 'Notification', 'SessionStart', 'SessionEnd'];

const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
fs.writeFileSync(settingsPath + `.bak-vibedeck`, JSON.stringify(settings, null, 2));

settings.hooks = settings.hooks || {};
let added = 0;
for (const ev of EVENTS) {
  const groups = settings.hooks[ev] = settings.hooks[ev] || [];
  const already = groups.some(g => (g.hooks || []).some(h => (h.command || '').includes('vibedeck')));
  if (already) continue;
  const hook = { type: 'command', command: `bash ${emit}`, timeout: 5 };
  if (groups.length && !groups[0].matcher) groups[0].hooks.push(hook);
  else groups.push({ hooks: [hook] });
  added++;
}
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
console.log(added ? `vibedeck: hooks added for ${added} events (backup at settings.json.bak-vibedeck)` : 'vibedeck: hooks already installed');
