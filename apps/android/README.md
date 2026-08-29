# apps/android — thin Compose shell (verify locally)

> This shell could not be built in the authoring session (no Android SDK
> there). All protocol logic lives in `packages/chat-core-kotlin`, which IS
> JVM-tested in-session; this module is Compose + Apollo Kotlin wiring only.

## Quickstart

1. Start the stack on your machine: `make dev` (repo root).
2. Open `apps/android` in Android Studio (it includes the Gradle wrapper), or:

   ```bash
   cd apps/android && ./gradlew :app:installDebug
   ```

   The Apollo plugin generates GraphQL types at build from
   `../../services/graphql/schema.graphqls`; the chat core is pulled in via a
   Gradle composite build (`includeBuild`) — no publishing step.

## Networking (the classic gotcha)

- **Emulator:** the host machine is **`10.0.2.2`** — already the default in
  `app/src/main/java/com/mwe/android/Config.kt`. Alternatively run
  `adb reverse tcp:7461 tcp:7461 && adb reverse tcp:7462 tcp:7462` and switch
  `Config.kt` to `localhost`.
- **Physical device:** replace the host in `Config.kt` with your machine's LAN
  IP. The manifest already sets `usesCleartextTraffic="true"` (dev only) so
  plain http works in debug builds.

The dev JWT is baked into `Config.kt`; re-mint with
`node scripts/mint-dev-token.mjs` to act as another user.

## What you should see

Type **"add a task to buy milk"**: tool chips (`⚙ create_task(...)`) appear in
the transcript, the confirmation streams in, and the task list at the top
updates **without a reload** — the chat core published `entity_changed` on the
invalidation bus and the ViewModel refetched its own query with
`FetchPolicy.NetworkOnly`, rewriting the normalized cache
(`AppViewModel.kt`). "open the milk task" highlights the row via the
client-executed `open_task` tool.
