# e2e — scripted conversations against the live stack

`make e2e` (or `pnpm --filter @mwe/e2e e2e`) boots executor + graphql + agent
as real child-process groups (ports 7480–7482) and runs the handoff-§4
scenarios in `src/scenarios.test.ts`, strictly in order:

1. **backend write** — SSE protocol shape, `entity_changed CREATED`,
   GraphQL visibility, audit attribution (user + run id + entity + status);
2. **read-then-write** — `list_tasks` → `complete_task`, `UPDATED`,
   `completed: true` via GraphQL;
3. **hybrid frontend tool** — deferred `open_task`, simulated client
   continuation, and the not-advertised capability fallback;

plus the auth gate (agent and GraphQL both 401 without a token).

Scenario 4 (web reconciliation) is component-level in
`apps/web/test/reconcile.test.tsx`; scenario 5 (mobile cores) lives in the
Kotlin/Swift suites. `make check` runs all of them.
