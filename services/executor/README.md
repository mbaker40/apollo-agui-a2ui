# services/executor — the true-backend stand-in

Owns the datastore (in-memory task store). Exposes REST (`GET/POST /tasks`,
`POST /tasks/:id/complete`, `GET /audit`) behind a **compliance middleware**
(`src/compliance.ts`): verified-identity headers required, `(caller, tool)`
allowlisted per exact route, every decision — allowed or denied — appended to
the audit log with the user and the AG-UI run id (mirrored to
`data/audit.log.jsonl`). In production this seam is the real (Scala) backend
with a service credential instead of trusted headers.

```bash
pnpm --filter @mwe/executor start     # :7460
pnpm --filter @mwe/executor test      # 11 vitest tests

curl -s localhost:7460/tasks -H 'x-caller-service: agent' -H 'x-user-id: me' \
  -H 'x-agent-run-id: r1' -H 'x-tool-name: list_tasks'
```

Headers contract: [/contracts/identity-headers.md](../../contracts/identity-headers.md).
