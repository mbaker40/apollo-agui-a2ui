# services/agent — AG-UI endpoint with a scripted model

POST `/agui` (`RunAgentInput`) → SSE event stream. The **scripted model**
(`src/agent/scripted_model.py`) is a pure, deterministic step function — the
keyless stand-in for an LLM: keyword scenarios ("add …", "done with …",
"open …"), capability-aware (it never calls `open_task` unless the run
declared it). The runner (`src/agent/runner.py`) executes backend tools
against the **executor over REST — never GraphQL**, emits one
`CUSTOM entity_changed` after each mutation, defers frontend tool calls to the
client, and turns failures into `RUN_ERROR`. The Langfuse/OTel hook location
is marked in the runner docstring.

```bash
cd services/agent
uv sync
uv run uvicorn agent.main:app --port 7462
uv run pytest -q          # 22 tests: model, runner, ASGI SSE, contract conformance
uv run ruff check . && uv run mypy src
```

Env: `EXECUTOR_URL`, `DEV_JWT_SECRET`, `AGENT_STREAM_DELAY_MS` (0 in tests),
`AGENT_PORT`. Recorded real transcripts: `make transcripts` (repo root).
