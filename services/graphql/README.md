# services/graphql — Apollo Server 5 facade

GraphQL read/UI plane over the executor's REST API — it owns **no data** and
never touches the store directly. Verifies the end user's dev JWT, then calls
the executor with forwarded identity headers under `graphql.*` tool names
(audited like everything else). Mutations exist for completeness/manual
testing; the agent's chat path deliberately does not use them.

```bash
pnpm --filter @mwe/graphql start          # :7461/graphql
pnpm --filter @mwe/graphql test           # 5 vitest tests (round-trip through a real executor)
pnpm --filter @mwe/graphql print-schema   # regenerate schema.graphqls (pinned by a test)

curl -s localhost:7461/graphql -H 'content-type: application/json' \
  -H "authorization: Bearer $(node ../../scripts/mint-dev-token.mjs)" \
  -d '{"query":"{ tasks { id title completed } }"}'
```

`schema.graphqls` is the canonical SDL the mobile shells' codegen points at.
