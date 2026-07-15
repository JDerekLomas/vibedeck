#!/bin/bash
# vibedeck hook emitter — forwards Claude Code hook events to the local
# vibedeck server, enriched with the caller's cmux pane (when inside cmux).
# Always exits 0 and never blocks the session for more than ~2s.
payload="$(cat)"
[ -z "$payload" ] && exit 0

ident="null"
if command -v cmux >/dev/null 2>&1 && [ -S /tmp/cmux.sock ]; then
  out="$(perl -e 'alarm 2; exec @ARGV' cmux --json --id-format both identify 2>/dev/null)"
  case "$out" in "{"*) ident="$out";; esac
fi

curl -s -m 2 -X POST "http://127.0.0.1:${VIBEDECK_PORT:-8423}/api/event" \
  -H 'Content-Type: application/json' \
  --data-binary "{\"payload\":${payload},\"cmux\":${ident}}" >/dev/null 2>&1

exit 0
