# Contract: `entity_changed` events

This is the reconciliation contract between the **agent** (producer) and **all
three clients** (consumers). It is how a chat-driven backend write becomes a
fresh GraphQL cache on every screen — without GraphQL subscriptions.

## Producer (agent service)

After a **mutating backend tool** (`create_task`, `complete_task`) returns
successfully from the executor, the agent emits one AG-UI `CUSTOM` event into
the run's SSE stream:

```json
{
  "type": "CUSTOM",
  "name": "entity_changed",
  "value": {
    "typename": "Task",
    "id": "task_0001",
    "kind": "CREATED",
    "scope": "tasks"
  }
}
```

- `value` MUST validate against [`schemas/entity_changed.schema.json`](./schemas/entity_changed.schema.json).
- `kind` is one of `CREATED | UPDATED | DELETED`.
- The event is emitted **after** the executor has durably applied the write and
  **before** the confirmation text for that tool, so a client that reconciles on
  receipt shows fresh data by the time the assistant's confirmation lands.
- Read-only tools (`list_tasks`) emit nothing.

## Consumers

### Web (Apollo Client)

`entity_changed` is forwarded into Apollo Client's refetch-event machinery
(`apps/web/src/lib/reconcile.ts`):

- `CREATED` → invalidate the root list fields registered for the typename
  (typename → fields registry; `Task` → `Query.tasks`).
- `UPDATED` → `cache.modify` + `INVALIDATE` on the identified entity's fields.
- `DELETED` → `cache.evict` + `cache.gc`.
- Only **active** (currently watched) queries refetch; a query nobody has
  mounted must trigger **zero** network requests (asserted by a component test).

### Mobile (invalidation bus)

The chat cores (`chat-core-kotlin`, `chat-core-swift`) parse the event and
publish `(typename, id, kind, scope)` on an **invalidation bus**. Mounted
screens subscribe filtered by the `scope`s they render and refetch their own
queries with their own variables using a network-only fetch policy
(`FetchPolicy.NetworkOnly` / `.fetchIgnoringCacheData`), which rewrites the
normalized cache and notifies watchers.

`scope` exists so a screen doesn't need to know every query another screen
runs — it re-runs _its own_ queries when a scope it renders is touched. v1 has
the single scope `tasks`.

## Conformance

Every platform has a test pinned to the fixtures in
[`fixtures/entity-changed/`](./fixtures/entity-changed/):

| Platform          | Test                                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------------- |
| TypeScript        | `contracts/test/conformance.test.ts` (schema-validates fixtures, checks exported constants)                 |
| Python (producer) | `services/agent/tests/test_contracts.py` (emitted payloads validate against the schema)                     |
| Kotlin            | `packages/chat-core-kotlin/.../ContractConformanceTest.kt` (parses fixtures into the core's model)          |
| Swift             | `packages/chat-core-swift/Tests/.../ContractConformanceTests.swift` (parses fixtures into the core's model) |
