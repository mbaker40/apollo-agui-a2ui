# apps/web — React + Apollo Client 4.2 + raw @ag-ui/client

## Quickstart

```bash
pnpm install            # once, at the repo root
make dev                # boots the whole stack, web on http://localhost:7463
# or just this app (stack must already be running):
cd apps/web && pnpm dev
```

Config (all optional — defaults hit the local stack):

| Env var            | Default                         |
| ------------------ | ------------------------------- |
| `VITE_AGENT_URL`   | `http://localhost:7462/agui`    |
| `VITE_GRAPHQL_URL` | `http://localhost:7461/graphql` |
| `VITE_DEV_JWT`     | checked-in `user-demo` token    |

To act as a different user, mint a token (`node scripts/mint-dev-token.mjs
alice alice@example.com "Alice Dev"`) and either set `VITE_DEV_JWT` or paste it
into DevTools: `localStorage.setItem('dev_jwt', '<token>')`, then reload.

## Try it

Type **"add a task to buy milk"**.

## What you should see

- an activity chip `create_task(buy milk)` appears while the tool runs, then
  the streamed confirmation `Created "buy milk" (task_0001). Anything else?`;
- the task list on the right gains the row **without any reload** — the
  `entity_changed` event drove an Apollo `RefetchEventManager` refetch of the
  watched query (`src/lib/reconcile.ts`);
- **"I'm done with the milk one"** strikes the row through (UPDATED);
- **"open the milk task"** runs the _frontend_ tool in your browser: the row
  highlights and the agent's follow-up text reflects what the client returned.

## Tests

`pnpm test` — reconciliation component tests (exact refetch counts, the
zero-request inactive case, DELETED eviction) and the frontend-tool loop
replayed over the recorded transcripts in `contracts/fixtures/transcripts/`.
