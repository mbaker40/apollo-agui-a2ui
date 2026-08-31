# Verification record

> **v2 addendum (same session, later):** after the ten-mutation scaling
> experiment ([SCALING.md](SCALING.md)) the in-session totals are:
> contracts 7, executor 23, graphql 6, agent 40 (pytest), web 11, Kotlin 20
> (all replaying the 9 recorded transcripts), e2e 19 — `make check` green.
> Swift gained mirrored v2 transcript tests (still verify-locally).
> Live v2 drive: `screenshots/web-v2-mutations.png`.

Captured in the authoring session (2026-08-29, Linux container, no secrets).
Everything below is reproducible with the listed commands; the two exceptions
(Swift, Docker image builds) are explained under **Network constraints**.

## `make check` — the full gate

```
$ make check
pnpm lint                                → eslint, clean
pnpm format:check                        → "All matched files use Prettier code style!"
uv run ruff check .                      → "All checks passed!"
./gradlew -q spotlessCheck               → clean
pnpm typecheck                           → tsc --noEmit clean in contracts, executor, graphql, web, e2e
uv run mypy src                          → "Success: no issues found in 8 source files"
pnpm -r --if-present test:
  @mwe/contracts     Tests  7 passed (7)
  @mwe/executor      Tests 11 passed (11)
  @mwe/graphql       Tests  5 passed (5)
  @mwe/web           Tests  8 passed (8)
uv run pytest -q                         → 22 passed
./gradlew -q test                        → 17 tests PASSED
swift test                               → SKIPPED (no toolchain in-session; see below)
pnpm --filter @mwe/e2e e2e               → Tests 6 passed (6)
check: all green
```

## E2E scenarios (handoff §4) against the live stack

`make e2e` boots executor + graphql + agent as real processes and runs
[`e2e/src/scenarios.test.ts`](../e2e/src/scenarios.test.ts):

- **auth gate**: agent and GraphQL both 401 without a valid bearer token.
- **scenario 1 — backend write**: SSE contains `TOOL_CALL_*` for
  `create_task`, exactly one `CUSTOM entity_changed {kind: CREATED}`, and the
  streamed confirmation; GraphQL `tasks` returns the row; the executor audit
  log attributes the write to `user-demo` **and** `run_e2e_1` with
  `entityId task_0001, status 201`.
- **scenario 2 — read-then-write**: `list_tasks` → `complete_task`,
  `entity_changed UPDATED`, GraphQL shows `completed: true`, both tool calls
  audited under `run_e2e_2`.
- **scenario 3 — hybrid tool**: with `open_task` advertised the run ends
  deferred (no result for the call, no text); the simulated client executes the
  tool and the continuation run streams `Opened "buy milk" for you.`; nothing
  reaches the executor for either run. Without the capability: zero tool
  calls and the fallback text.

Scenario 4 (web reconciliation) is component-level in
[`apps/web/test/reconcile.test.tsx`](../apps/web/test/reconcile.test.tsx):
CREATED/UPDATED refetch **exactly** the mounted watched query (fetch-count
asserted), a never-fetched query triggers **zero** requests, unmount stops
refetching, DELETED evicts from the cache. Scenario 5 (mobile cores) is the
Kotlin/Swift suites replaying the recorded transcripts below.

## Recorded real-agent SSE transcripts

[`contracts/fixtures/transcripts/`](../contracts/fixtures/transcripts/) was
recorded from the live executor+agent stack by
[`scripts/record-transcripts.mjs`](../scripts/record-transcripts.mjs)
(`make transcripts` re-records). They double as the `curl -N` proof — e.g.:

```
$ curl -N http://localhost:7462/agui -H 'content-type: application/json' \
    -H "authorization: Bearer $(node scripts/mint-dev-token.mjs)" \
    -d '{"threadId":"t","runId":"r1","state":null,"context":[],"forwardedProps":null,"tools":[],
         "messages":[{"id":"u1","role":"user","content":"add a task to buy milk"}]}'
data: {"type":"RUN_STARTED","threadId":"t","runId":"r1"}
data: {"type":"TOOL_CALL_START","toolCallId":"r1_call_1","toolCallName":"create_task","parentMessageId":"r1_msg_2"}
data: {"type":"TOOL_CALL_ARGS","toolCallId":"r1_call_1","delta":"{\"title\": \"buy milk\"}"}
data: {"type":"TOOL_CALL_END","toolCallId":"r1_call_1"}
data: {"type":"TOOL_CALL_RESULT","messageId":"r1_msg_3","toolCallId":"r1_call_1","content":"{...task json...}","role":"tool"}
data: {"type":"CUSTOM","name":"entity_changed","value":{"typename":"Task","id":"task_0001","kind":"CREATED","scope":"tasks"}}
data: {"type":"TEXT_MESSAGE_START","messageId":"r1_msg_4","role":"assistant"}
data: ... deltas ...
data: {"type":"RUN_FINISHED","threadId":"t","runId":"r1"}
```

The six checked-in transcripts cover: create, read-then-complete, deferred
`open_task`, its continuation, the capability fallback, and `RUN_ERROR` with
the executor down. The Kotlin and Swift test suites replay these exact files.

## Live web app (Playwright-driven)

The full stack was booted with `make dev` and driven in real Chromium:
"add a task to buy milk" / "add a task to call the vet" → rows appear via
event-driven refetch (no reload); "I'm done with the milk one" → strike-through
via UPDATED; "open the vet task" → the frontend tool executes in the browser
and highlights the row, and the agent's follow-up reflects the client result.

![backend write](screenshots/web-backend-write.png)
![hybrid open_task](screenshots/web-hybrid-open-task.png)

## Network constraints hit in the authoring session

The session's egress policy denied CONNECT (HTTP 403 at the proxy) to:

- `download.swift.org` — every official Swift-for-Linux toolchain tarball.
- `production.cloudfront.docker.com` — Docker Hub **blob** storage (manifest
  negotiation succeeded; layer downloads did not), which blocks both
  `docker pull swift:…` and `docker compose up --build` base images.

Consequences, stated plainly:

- **`chat-core-swift` is not compile-verified.** The package was
  review-checked and mirrors the tested Kotlin core 1:1 against the same
  fixtures, but until `swift test` runs on your machine treat it as unproven.
  It deliberately targets swift-tools 5.10 so strict-concurrency issues, if
  any, surface as warnings rather than hard errors.
- **`docker-compose.yml` is validated (`docker compose config`) but a full
  `docker compose up --build` was not run.** The process-based `make dev`
  path is the in-session-verified bring-up.

Both are marked in the README's verification matrix.

## Repo hygiene

After the full build + test cycle above, `git status` is clean — the root
`.gitignore` covers node_modules, dist, coverage, `.venv`, `__pycache__`,
Gradle/Android artifacts, SwiftPM `.build`, Xcode noise, env files, the
executor's local data dir, and the generated iOS GraphQL package.
