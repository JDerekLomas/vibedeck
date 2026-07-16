# vibedeck — build session handoff (2026-07-15 → 07-16)

Built from scratch in one session, from Derek's voice riff ("cmux is okay, but…") to a standalone app. Repo: github.com/JDerekLomas/vibedeck (public). All work committed & pushed through `bbf8ff3`.

## What exists now

- **Product**: attention board for parallel Claude Code sessions. Split view: triaged session list left (Needs you / In motion / At rest / Earlier), detail right rendered as a *letter* (letterhead à la Derek's Milo letter PDF, serif body, sign-off) + *live embedded terminal* + *newspaper gazette* (masthead, stats dateline, two-column last exchange, glyph filmstrip).
- **Data**: reads `~/.claude/projects/**/*.jsonl` (streamed/tail-sampled; 2.9GB corpus handled); live state via global hooks in `~/.claude/settings.json` → `hooks/emit.sh` → POST /api/event. Hook payload carries cmux pane UUIDs (`cmux identify`) and tmux name (`VIBEDECK_TERM`).
- **Brain**: Haiku 4.5 per-session title/status/asks/emoji/milestone + **SVG glyph** (prompt v3: subject→object mapping, banned generic doc/checkmark, no visual exemplar — few-shot SVG caused mass copying; keep-if-good returns previous_svg verbatim unless subject changed). ~$0.004/update, throttled (top 30 sessions, 6-msg delta or stop/notification, 90s cooldown). Gemini image gen removed (old PNGs remain in filmstrips).
- **Terminals**: sessions run in headless tmux `vd-<id8>`; xterm.js ↔ `/term/:id` websocket ↔ node-pty `tmux attach`. Survive server/app restarts. Wishes birth sessions in tmux. cmux optional (read-only peek + focus for cmux-resident sessions).
- **Shell**: native Swift app `/Applications/vibedeck.app` (WKWebView + menu-bar `▤ N` needs-you badge; rebuilds via `app/build.sh`). Server = launchd `com.vibedeck` (KeepAlive). State/keys in `~/.vibedeck/` (env chmod 600, keys copied from sourcelibrary env).

## Gotchas encountered (all fixed, don't re-trip)

- launchd strips PATH → cmux/tmux/claude resolved by absolute path (src/cmux.mjs, src/term.mjs).
- node-pty on Node 25: prebuild lacks spawn-helper → `posix_spawnp failed`; fix `npm rebuild node-pty --build-from-source` (README note).
- cmux short refs (`workspace:N`) are recycled → focus requires UUIDs from `identify --id-format both` (keys: `workspace_id`/`pane_id`/`surface_id`).
- WKWebView has no `navigator.clipboard` → safeCopy() textarea fallback; all UI actions must end in a toast (silent-failure bug class).
- Soft SSE refresh rebuilds detail HTML → persistent skeleton (`#letterSlot`/`#termSlot`/`#gazSlot`) so live xterm survives.

## Open threads / next ideas

- Live tmux left running: `vd-3c08e3a2` (Stonehenge session, mid-conversation, asked for Background-section review).
- "Since you left" recap on jump-in; menu-bar push notifications on needs-you flips.
- Storage session glyph still generic (one holdout); glyph regens happen on milestones.
- Wish flow doesn't auto-select the newborn session (appears via hooks; could auto-focus once session id binds).
- Possible product echo: this letter/gazette-over-sessions UI maps onto MakeMode as a non-coder session dashboard.
