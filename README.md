# vibedeck

An **attention board** for parallel Claude Code sessions. Terminals tell you what a session is printing; vibedeck tells you what each session *is* — a living title, a two-sentence "now", what it's asking of you, and an evolving AI-painted cover so you recognize it in 200ms instead of reading scrollback.

Sessions are triaged by who-needs-you, not by window position:

- **Needs you** — blocked on input, or stopped while asking you something ("approve the deploy")
- **In motion** — agents actively working
- **At rest / Earlier** — recognizable at a glance when you want to pick one back up

Click a card for the full story: the original wish, the current state, a filmstrip of cover art as the work evolved, the last exchange — and **Jump in**, which focuses the session's live cmux pane (if it ran inside cmux) or resumes it in a fresh cmux workspace. **+ new wish** starts a new session from an intent, not a blank prompt.

## Terminals

Sessions run inside **headless tmux** (`vd-<id>`), so they survive vibedeck restarts and need no terminal app. The detail pane embeds a real terminal (xterm.js) attached over a WebSocket through node-pty — click "Open terminal here" (or a row's ↗) to resume a session in place and type directly. "+ new wish" births new sessions the same way; hooks report the tmux name back (`VIBEDECK_TERM`) so the board links them up. Sessions living in cmux panes still get a read-only live peek plus a focus-cmux button.

Note: `node-pty` needs a source build on odd Node versions — if `npm install` leaves it broken (`posix_spawnp failed`), run `npm rebuild node-pty --build-from-source`.

## How it works

- Zero-dependency Node server on `127.0.0.1:8423`. Reads session transcripts from `~/.claude/projects/**/*.jsonl` (streamed + tailed incrementally; older sessions head/tail-sampled).
- Claude Code hooks (`hooks/emit.sh`, merged into `~/.claude/settings.json`) push live state: prompt submitted → working, Stop → resting, Notification → needs you. Inside cmux, the hook also captures which pane the session lives in (`cmux identify`) so Jump-in can focus it.
- Titles/status/asks: Haiku over recent transcript deltas (`ANTHROPIC_API_KEY`). Cover art: Gemini image gen (`GEMINI_API_KEY`) in a consistent risograph series style, regenerated on milestones; deterministic SVG fallback without a key.
- Keys live in `~/.vibedeck/env` (chmod 600, never in the repo). All state in `~/.vibedeck/`.

## The app

`bash app/build.sh` compiles a native Swift shell (WKWebView, ~no dependencies) into `/Applications/vibedeck.app`: a real window, Dock icon, and a menu-bar item showing the needs-you count (amber `▤ N` when sessions are waiting on you). If the server is down the app kickstarts the launchd service itself.

## Setup

```bash
npm run setup            # copies keys into ~/.vibedeck/env, installs hooks
bin/vibedeck install     # launchd service: starts at login, self-restarts
bin/vibedeck open        # open the board
```

`bin/vibedeck start|stop|status|logs|uninstall` for manual control. Port: `VIBEDECK_PORT` (default 8423).
