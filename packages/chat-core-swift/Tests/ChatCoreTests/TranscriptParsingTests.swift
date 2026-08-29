import XCTest
@testable import ChatCore

/// Scenario 5 (handoff §4): recorded real-agent SSE transcripts parse into the core's model.
final class TranscriptParsingTests: XCTestCase {
    func testCreateTaskTranscriptFullBackendWriteSequence() throws {
        let events = try SseParser.parseTranscript(Fixtures.transcript("create_task.sse"))
        XCTAssertEqual(
            events.map(\.type),
            [
                "RUN_STARTED",
                "TOOL_CALL_START", "TOOL_CALL_ARGS", "TOOL_CALL_END", "TOOL_CALL_RESULT",
                "CUSTOM",
                "TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_CONTENT",
                "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END",
                "RUN_FINISHED",
            ]
        )

        guard case let .toolCallStart(_, toolCallName, _) = events[1] else {
            return XCTFail("expected TOOL_CALL_START")
        }
        XCTAssertEqual(toolCallName, "create_task")

        guard case let .custom(name, value) = events[5] else {
            return XCTFail("expected CUSTOM")
        }
        XCTAssertEqual(name, entityChangedEventName)
        let change = try JSONDecoder().decode(
            EntityChanged.self, from: JSONEncoder().encode(value)
        )
        XCTAssertEqual(
            change,
            EntityChanged(typename: "Task", id: "task_0001", kind: .created, scope: "tasks")
        )
        // And the payload matches the canonical cross-platform fixture as JSON.
        XCTAssertEqual(try JSONValue.parse(Fixtures.json("entity-changed/created.json")), value)

        let text = events.compactMap { event -> String? in
            if case let .textMessageContent(_, delta) = event { return delta }
            return nil
        }.joined()
        XCTAssertEqual(text, "Created \"buy milk\" (task_0001). Anything else?")
    }

    func testCompleteTaskTranscriptReadThenWriteEmitsUpdated() throws {
        let events = try SseParser.parseTranscript(Fixtures.transcript("complete_task.sse"))
        let toolNames = events.compactMap { event -> String? in
            if case let .toolCallStart(_, name, _) = event { return name }
            return nil
        }
        XCTAssertEqual(toolNames, ["list_tasks", "complete_task"])

        let customs = events.compactMap { event -> JSONValue? in
            if case let .custom(_, value) = event { return value }
            return nil
        }
        XCTAssertEqual(customs.count, 1)
        let change = try JSONDecoder().decode(
            EntityChanged.self, from: JSONEncoder().encode(customs[0])
        )
        XCTAssertEqual(
            change,
            EntityChanged(typename: "Task", id: "task_0001", kind: .updated, scope: "tasks")
        )
    }

    func testOpenTaskDeferredTranscriptFrontendCallHasNoResult() throws {
        let events = try SseParser.parseTranscript(Fixtures.transcript("open_task_deferred.sse"))
        var starts: [(id: String, name: String)] = []
        var resultCallIds: [String] = []
        var textDeltas = 0
        for event in events {
            switch event {
            case let .toolCallStart(id, name, _): starts.append((id, name))
            case let .toolCallResult(_, toolCallId, _): resultCallIds.append(toolCallId)
            case .textMessageContent: textDeltas += 1
            default: break
            }
        }
        XCTAssertEqual(starts.map(\.name), ["list_tasks", "open_task"])
        XCTAssertEqual(resultCallIds.count, 1)
        XCTAssertFalse(resultCallIds.contains(starts[1].id))
        XCTAssertEqual(events.last?.type, "RUN_FINISHED")
        XCTAssertEqual(textDeltas, 0)
    }

    func testRunErrorTranscriptSurfacesRunError() throws {
        let events = try SseParser.parseTranscript(Fixtures.transcript("run_error.sse"))
        guard case let .runError(message, _) = events.last else {
            return XCTFail("expected RUN_ERROR last")
        }
        XCTAssertTrue(message.contains("executor unreachable"))
    }
}
