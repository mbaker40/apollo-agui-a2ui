#!/usr/bin/env bash
# Runs the whole demo stack as local processes (the in-session-verifiable
# bring-up; docker compose is the containerized alternative).
set -euo pipefail
cd "$(dirname "$0")/.."

EXECUTOR_PORT="${EXECUTOR_PORT:-7460}"
GRAPHQL_PORT="${GRAPHQL_PORT:-7461}"
AGENT_PORT="${AGENT_PORT:-7462}"
WEB_PORT="${WEB_PORT:-7463}"
export EXECUTOR_PORT GRAPHQL_PORT AGENT_PORT WEB_PORT
export EXECUTOR_URL="${EXECUTOR_URL:-http://localhost:$EXECUTOR_PORT}"

cleanup() {
  trap - EXIT INT TERM
  kill 0 2>/dev/null || true
}
trap cleanup EXIT INT TERM

(cd services/executor && npx tsx src/main.ts) &
(cd services/graphql && npx tsx src/main.ts) &
(cd services/agent && uv run uvicorn agent.main:app --host 0.0.0.0 --port "$AGENT_PORT") &
(cd apps/web && pnpm dev) &

sleep 2
cat <<BANNER

  ─────────────────────────────────────────────────────
   web        http://localhost:$WEB_PORT
   graphql    http://localhost:$GRAPHQL_PORT/graphql
   agent      http://localhost:$AGENT_PORT/agui   (POST + SSE)
   executor   http://localhost:$EXECUTOR_PORT      (REST + /audit)

   Try: "add a task to buy milk"        (Ctrl-C stops all)
  ─────────────────────────────────────────────────────

BANNER

wait
