#!/usr/bin/env bash
# CI gate: fail when a Tailwind token class generates no CSS.
#
# The scan needs the CSS the bundler actually emits, so this starts the Vite
# renderer dev server on a dedicated port, waits for it, runs the report, then
# shuts the server down. Exit code is non-zero when any dead class remains.
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${DEAD_CLASS_PORT:-5174}"
CSS_FILE="$(mktemp)"
LOG_FILE="$(mktemp)"
VITE_PID=""

cleanup() {
  if [[ -n "$VITE_PID" ]]; then
    kill "$VITE_PID" 2>/dev/null || true
    wait "$VITE_PID" 2>/dev/null || true
  fi
  rm -f "$CSS_FILE" "$LOG_FILE"
}
trap cleanup EXIT

node ../node_modules/vite/bin/vite.js \
  --config vite.renderer.config.mts \
  --port "$PORT" --strictPort >"$LOG_FILE" 2>&1 &
VITE_PID=$!

for _ in $(seq 1 60); do
  if curl -sf "http://localhost:$PORT/src/styles/main.css?direct" -o "$CSS_FILE"; then
    break
  fi
  sleep 1
done

if [[ ! -s "$CSS_FILE" ]]; then
  echo "error: could not read generated CSS from the dev server" >&2
  cat "$LOG_FILE" >&2
  exit 2
fi

python3 scripts/scan-dead-classes.py --css "$CSS_FILE" --fail-on-dead
