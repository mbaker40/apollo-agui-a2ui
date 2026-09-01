#!/usr/bin/env bash
# Runs the A2UI composer pair as local processes: the catalog renderer on
# 7465 and the composer shell on 7464 (docs/composer/CONTRACT.md §1).
set -euo pipefail
cd "$(dirname "$0")/.."

cleanup() {
  trap - EXIT INT TERM
  kill 0 2>/dev/null || true
}
trap cleanup EXIT INT TERM

pnpm --filter @mwe/composer-catalog dev &
pnpm --filter @mwe/composer dev &

sleep 2
cat <<BANNER

  ─────────────────────────────────────────────────────
   composer   http://localhost:7464
   catalog    http://localhost:7465   (iframed renderer)

   Drag a glossary entry onto the canvas   (Ctrl-C stops both)
  ─────────────────────────────────────────────────────

BANNER

wait
