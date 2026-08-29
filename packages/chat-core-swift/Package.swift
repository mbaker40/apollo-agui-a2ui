// swift-tools-version: 5.10
// Deliberately 5.10 (language mode 5): this package could not be compile-
// verified in the authoring session (egress policy blocked every Swift
// toolchain source), so concurrency diagnostics are kept as warnings rather
// than risking a hard Swift-6-mode failure on first local build. The code is
// written actor-first; bump to 6.0 once `swift test` passes locally.
import PackageDescription

let package = Package(
    name: "ChatCore",
    platforms: [
        .iOS(.v16),
        .macOS(.v13),
    ],
    products: [
        .library(name: "ChatCore", targets: ["ChatCore"]),
    ],
    targets: [
        .target(name: "ChatCore"),
        .testTarget(name: "ChatCoreTests", dependencies: ["ChatCore"]),
    ]
)
