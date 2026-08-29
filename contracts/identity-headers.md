# Contract: identity headers (service → executor)

The executor never sees end-user bearer tokens. Callers (agent, GraphQL facade)
verify the user's JWT themselves and forward identity as headers; the
executor's **compliance middleware** requires them, enforces a per-tool
allowlist, and writes every decision to the audit log.

Canonical names live in [`fixtures/identity-headers.json`](./fixtures/identity-headers.json):

| Header             | Meaning                                                                      | Required               |
| ------------------ | ---------------------------------------------------------------------------- | ---------------------- |
| `x-caller-service` | Which service is calling (`agent`, `graphql`, `e2e`)                         | always                 |
| `x-user-id`        | Verified `sub` claim of the end user                                         | always                 |
| `x-user-email`     | Verified `email` claim                                                       | optional               |
| `x-agent-run-id`   | AG-UI `runId` that caused this call                                          | when caller is `agent` |
| `x-tool-name`      | Logical tool/operation being performed (e.g. `create_task`, `graphql.tasks`) | always                 |

The `(x-caller-service, x-tool-name)` pair must be in the executor's allowlist
**and** match the route actually being hit, or the request is denied with 403 —
and the denial is audited too.

> Demo-grade trust model, real shape: in production the executor would verify a
> service-to-service credential (mTLS / signed service token) instead of
> trusting these headers blindly. The middleware seam is the point.
