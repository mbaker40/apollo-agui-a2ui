import Foundation

/// Shared cross-platform fixtures, located relative to this source file.
enum Fixtures {
    static let root = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent() // ChatCoreTests
        .deletingLastPathComponent() // Tests
        .deletingLastPathComponent() // chat-core-swift
        .deletingLastPathComponent() // packages
        .appendingPathComponent("contracts")
        .appendingPathComponent("fixtures")

    static func transcript(_ name: String) throws -> String {
        try String(contentsOf: root.appendingPathComponent("transcripts/\(name)"), encoding: .utf8)
    }

    static func json(_ relative: String) throws -> String {
        try String(contentsOf: root.appendingPathComponent(relative), encoding: .utf8)
    }
}
