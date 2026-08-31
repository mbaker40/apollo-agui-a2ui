import XCTest
@testable import ChatCore

/// v2 transcripts (bulk, DELETED, cross-scope) replayed through the UNCHANGED
/// core — the scaling claim in docs/SCALING.md: ten new server-side mutations
/// required zero edits to the event model, parser, session, or bus.
final class TranscriptParsingV2Tests: XCTestCase {
    private func customs(_ events: [AgUiEvent]) throws -> [EntityChanged] {
        try events.compactMap { event -> EntityChanged? in
            guard case let .custom(_, value) = event else { return nil }
            return try JSONDecoder().decode(EntityChanged.self, from: JSONEncoder().encode(value))
        }
    }

    func testDeleteTaskTranscriptDeletedKindHasARealProducer() throws {
        let events = try SseParser.parseTranscript(Fixtures.transcript("delete_task.sse"))
        XCTAssertEqual(
            try customs(events),
            [EntityChanged(typename: "Task", id: "task_0002", kind: .deleted, scope: "tasks")]
        )
    }

    func testClearCompletedTranscriptBulkEmitsOneEventPerRemovedTask() throws {
        let events = try SseParser.parseTranscript(Fixtures.transcript("clear_completed.sse"))
        let changes = try customs(events)
        XCTAssertFalse(changes.isEmpty)
        XCTAssertTrue(changes.allSatisfy { $0.kind == .deleted && $0.scope == "tasks" })
        let text = events.compactMap { event -> String? in
            if case let .textMessageContent(_, delta) = event { return delta }
            return nil
        }.joined()
        let plural = changes.count == 1 ? "" : "s"
        XCTAssertEqual(text, "Cleared \(changes.count) completed task\(plural).")
    }

    func testTagTaskTranscriptOneRunPublishesAcrossTwoScopesOnTheBus() async throws {
        let transcript = try Fixtures.transcript("tag_task.sse")
        let transport = ReplayTransport(transcript: transcript)
        let session = ChatSession(transport: transport)

        let taskStream = await session.bus.subscribe(scopes: ["tasks"])
        let tagStream = await session.bus.subscribe(scopes: ["tags"])
        var taskIterator = taskStream.makeAsyncIterator()
        var tagIterator = tagStream.makeAsyncIterator()

        await session.send("tag the vet task as urgent")

        let taskChange = await taskIterator.next()
        let tagChange = await tagIterator.next()
        XCTAssertEqual(
            taskChange,
            EntityChanged(typename: "Task", id: "task_0002", kind: .updated, scope: "tasks")
        )
        XCTAssertEqual(
            tagChange,
            EntityChanged(typename: "Tag", id: "tag_0001", kind: .created, scope: "tags")
        )

        let state = await session.state
        let sawNewTag = state.messages.contains { message in
            if case let .assistant(assistant) = message {
                return assistant.content?.contains("(new tag)") == true
            }
            return false
        }
        XCTAssertTrue(sawNewTag)
    }
}

private struct ReplayTransport: AgUiTransport {
    let transcript: String

    func run(_ input: RunAgentInput) -> AsyncThrowingStream<AgUiEvent, Error> {
        AsyncThrowingStream { continuation in
            do {
                for event in try SseParser.parseTranscript(transcript) {
                    continuation.yield(event)
                }
                continuation.finish()
            } catch {
                continuation.finish(throwing: error)
            }
        }
    }
}
