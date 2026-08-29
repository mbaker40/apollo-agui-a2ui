# chat-core-kotlin — pure-JVM AG-UI chat core

Everything interesting about the Android client, minus Android: sealed AG-UI
event model (unknown event types degrade to `Unknown`, never crash), an
incremental chunk-safe SSE parser, an OkHttp transport, the event→action
`ChatSession` with the frontend-tool continuation loop
(/contracts/frontend-tools.md), and the scope-filtered `InvalidationBus` that
screens use to refetch their own queries network-only
(/contracts/entity-events.md).

```bash
./gradlew test            # 17 JVM tests
./gradlew spotlessCheck   # ktlint
```

Tests replay the **recorded real-agent transcripts** in
`../../contracts/fixtures/transcripts/` (the same files the Swift core and the
web tool-loop test replay) and pin the contracts fixtures — protocol parity is
enforced by shared bytes, not by convention. The Android shell consumes this
library via a Gradle composite build.
