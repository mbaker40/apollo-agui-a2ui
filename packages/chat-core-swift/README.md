# chat-core-swift — SwiftPM AG-UI chat core

1:1 mirror of `chat-core-kotlin`, with no UIKit/SwiftUI dependency: Codable
AG-UI event model (unknown types degrade to `.unknown`), the same incremental
SSE parser, a URLSession delegate-bridged transport (works on Linux
corelibs-foundation, no `URLSession.bytes` needed), the actor `ChatSession`
with the frontend-tool continuation loop, and the `InvalidationBus` actor.

```bash
swift test    # Linux or macOS
```

> **Honesty note:** the authoring session's egress policy blocked every Swift
> toolchain source, so this package is **not compile-verified** there (see
> ../../docs/VERIFICATION.md). It replays the same recorded transcripts and
> contract fixtures as the tested Kotlin core; `Package.swift` targets
> swift-tools **5.10** so strict-concurrency findings surface as warnings on
> your first build — bump to 6.0 once `swift test` is green for you.
