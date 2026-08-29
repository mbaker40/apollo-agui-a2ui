# apps/ios — thin SwiftUI shell (verify locally)

> This shell could not be built in the authoring session (no Xcode there, and
> the egress policy blocked Swift toolchains — see docs/VERIFICATION.md). All
> protocol logic lives in `packages/chat-core-swift`; this module is SwiftUI +
> Apollo iOS wiring only.

## Quickstart

1. Start the stack on your machine: `make dev` (repo root).
2. Generate the Apollo iOS types (once, and after schema changes):

   ```bash
   cd apps/ios
   # any recent apollo-ios-cli; one way to get it:
   #   git clone https://github.com/apollographql/apollo-ios-cli && swift run …
   # or grab the release binary from the apollo-ios repo
   ./apollo-ios-cli generate   # reads apollo-codegen-config.json → ./GraphQL package
   ```

3. Generate and open the Xcode project:

   ```bash
   brew install xcodegen
   xcodegen generate
   open MweTasks.xcodeproj
   ```

4. Select an iOS 16+ simulator and Run.

## Networking

- **Simulator:** `localhost` reaches your machine directly — the defaults in
  `Sources/Config.swift` just work.
- **Physical device:** replace the hosts in `Config.swift` with your LAN IP.
  `NSAllowsLocalNetworking` is already set in the generated Info.plist (dev
  only) so plain http works.

The dev JWT is baked into `Config.swift`; re-mint with
`node scripts/mint-dev-token.mjs` to act as another user.

## What you should see

Type **"add a task to buy milk"**: tool chips (`⚙ create_task(...)`) appear in
the transcript, the confirmation streams in, and the task list at the top
updates **without a reload** — the chat core published `entity_changed` on the
invalidation bus and `AppModel` refetched its own query with
`.fetchIgnoringCacheData`, rewriting the Apollo store watched by the list.
"open the milk task" highlights the row via the client-executed `open_task`
tool.
