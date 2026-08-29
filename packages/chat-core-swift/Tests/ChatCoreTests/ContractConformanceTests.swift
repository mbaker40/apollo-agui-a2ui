import XCTest
@testable import ChatCore

/// Pins this platform to the shared /contracts fixtures.
final class ContractConformanceTests: XCTestCase {
    func testEntityChangedFixturesParseAndRoundTrip() throws {
        let expected: [(String, EntityChanged.Kind)] = [
            ("created", .created), ("updated", .updated), ("deleted", .deleted),
        ]
        for (name, kind) in expected {
            let raw = try Fixtures.json("entity-changed/\(name).json")
            let parsed = try JSONDecoder().decode(EntityChanged.self, from: Data(raw.utf8))
            XCTAssertEqual(
                parsed,
                EntityChanged(typename: "Task", id: "task_0001", kind: kind, scope: "tasks")
            )
            let reEncoded = try JSONValue.parse(
                String(decoding: JSONEncoder().encode(parsed), as: UTF8.self)
            )
            XCTAssertEqual(reEncoded, try JSONValue.parse(raw))
        }
    }

    func testOpenTaskDeclarationMatchesCanonicalFixture() throws {
        let raw = try Fixtures.json("frontend-tools/open-task.json")
        let parsed = try JSONDecoder().decode(ToolDefinition.self, from: Data(raw.utf8))
        XCTAssertEqual(parsed, StandardFrontendTools.openTask)
        let reEncoded = try JSONValue.parse(
            String(decoding: JSONEncoder().encode(StandardFrontendTools.openTask), as: UTF8.self)
        )
        XCTAssertEqual(reEncoded, try JSONValue.parse(raw))
    }

    func testRunAgentInputAlwaysEncodesRequiredKeys() throws {
        // The AG-UI Python SDK REQUIRES context and forwardedProps; omitting them is a 422.
        let input = RunAgentInput(
            threadId: "t",
            runId: "r",
            messages: [.user(UserMessage(id: "u1", content: "hi"))]
        )
        guard case let .object(fields) = try JSONValue.parse(
            String(decoding: JSONEncoder().encode(input), as: UTF8.self)
        ) else {
            return XCTFail("expected object")
        }
        for key in ["threadId", "runId", "messages", "tools", "context", "state", "forwardedProps"] {
            XCTAssertNotNil(fields[key], "RunAgentInput must always encode '\(key)'")
        }
        XCTAssertEqual(fields["forwardedProps"], .null)
        XCTAssertEqual(fields["context"], .array([]))
    }
}
