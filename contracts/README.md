# contracts — the cross-platform source of truth

| File                                                                                     | Contract                                                                                    |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [entity-events.md](entity-events.md)                                                     | `entity_changed` reconciliation: producer rules, web + mobile consumer rules                |
| [frontend-tools.md](frontend-tools.md)                                                   | client-declared tools: declaration shape, capability awareness, the deferred-execution loop |
| [identity-headers.md](identity-headers.md)                                               | service → executor identity forwarding + allowlist semantics                                |
| `schemas/*.json`                                                                         | JSON Schemas for the above                                                                  |
| `fixtures/entity-changed/`, `fixtures/frontend-tools/`, `fixtures/identity-headers.json` | canonical example payloads                                                                  |
| `fixtures/transcripts/*.sse`                                                             | **recorded real-agent SSE streams** (`make transcripts` re-records)                         |

Conformance is enforced by tests on every platform — TS
(`contracts/test/conformance.test.ts`), Python
(`services/agent/tests/test_contracts.py`), Kotlin
(`ContractConformanceTest.kt`), Swift (`ContractConformanceTests.swift`) — and
the transcripts are replayed by the web tool-loop test and both mobile cores,
so a drifting implementation fails a build instead of silently forking.
