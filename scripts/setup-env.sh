#!/bin/bash
# Create ~/.vibedeck/env with the two keys vibedeck uses, pulled from an
# existing local env file (never committed anywhere, chmod 600).
set -uo pipefail
DEST="$HOME/.vibedeck/env"
mkdir -p "$HOME/.vibedeck"

SRC="${1:-$HOME/sourcelibrary/.env.production.local}"
touch "$DEST"; chmod 600 "$DEST"

for KEY in ANTHROPIC_API_KEY GEMINI_API_KEY; do
  if grep -q "^$KEY=" "$DEST" 2>/dev/null; then
    echo "= $KEY already set in $DEST"
    continue
  fi
  VAL="$(grep -E "^$KEY=" "$SRC" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"')"
  if [ -n "$VAL" ]; then
    echo "$KEY=$VAL" >> "$DEST"
    echo "+ $KEY copied from $SRC"
  else
    echo "! $KEY not found in $SRC — add it to $DEST manually"
  fi
done
