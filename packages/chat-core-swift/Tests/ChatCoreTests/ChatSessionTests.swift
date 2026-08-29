import Foundation
import XCTest
@testable import ChatCore

/// Replays the recorded transcripts through the session state machine + tool loop.
final class ChatSessionTests: XCTestCase {
    /// Plays back queued transcripts, one per run, recording every RunAgentInput.
    private final class ScriptedTransport: AgUiTransport, @unchecked Sendable {
        private let lock = NSLock()
        private var queue: [String]
        private(set) var inputs: [RunAgentInput] = []

        init(_ transcripts: [String]) {
            queue = transcripts
        }

        func run(_ input: RunAgentInput) -> AsyncThrowingStream<AgUiEvent, Error> {
            lock.lock()
            inputs.append(input)
            let transcript = queue.isEmpty ? "" : queue.removeFirst()
            lock.unlock()
            return AsyncThrowingStream { continuation in
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

    private func lastAssistantText(_ state: ChatState) -> String? {
        for case let .assistant(message) in state.messages.reversed() {
            if let content = message.content, !content.isEmpty { return content }
        }
        return nil
    }

    func testFrontendToolLoopExecutesOpenTaskLocallyAndContinues() async throws {
        let transport = ScriptedTransport([
            try Fixtures.transcript("open_task_deferred.sse"),
            try Fixtures.transcript("open_task_continuation.sse"),
        ])
        let executed = ArgsRecorder()
        let session = ChatSession(
            transport: transport,
            frontendTools: FrontendToolRegistry([
                FrontendTool(declaration: StandardFrontendTools.openTask) { args in
                    await executed.record(args)
                    return .object(["status": .string("opened"), "id": args["id"] ?? .null])
                },
            ])
        )

        await session.send("open the milk task")

        // The tool ran locally, once, with the streamed args.
        let recorded = await executed.args
        XCTAssertEqual(recorded.count, 1)
        XCTAssertEqual(recorded.first?["id"]?.stringValue, "task_0001")

        // Two runs: deferred + continuation carrying the tool result and the capability.
        XCTAssertEqual(transport.inputs.count, 2)
        let continuation = transport.inputs[1]
        XCTAssertEqual(continuation.tools.map(\.name), ["open_task"])
        let toolContents = continuation.messages.compactMap { message -> String? in
            if case let .tool(toolMessage) = message { return toolMessage.content }
            return nil
        }
        XCTAssertTrue(toolContents.contains(#"{"id":"task_0001","status":"opened"}"#))

        let state = await session.state
        XCTAssertEqual(lastAssistantText(state), "Opened \"buy milk\" for you.")
        XCTAssertFalse(state.running)
        XCTAssertNil(state.error)
        let pending = await session.pendingFrontendCalls()
        XCTAssertTrue(pending.isEmpty)
    }

    func testBackendWritePublishesEntityChangedOnTheBus() async throws {
        let session = ChatSession(
            transport: ScriptedTransport([try Fixtures.transcript("create_task.sse")])
        )
        let stream = await session.bus.subscribe(scopes: ["tasks"])
        var iterator = stream.makeAsyncIterator()

        await session.send("add a task to buy milk")

        let change = await iterator.next()
        XCTAssertEqual(
            change,
            EntityChanged(typename: "Task", id: "task_0001", kind: .created, scope: "tasks")
        )
        let state = await session.state
        XCTAssertEqual(lastAssistantText(state), "Created \"buy milk\" (task_0001). Anything else?")
    }

    func testCapabilityFallbackNoToolCallStreamedExplanation() async throws {
        let session = ChatSession(
            transport: ScriptedTransport([try Fixtures.transcript("capability_fallback.sse")])
        )
        await session.send("open the milk task")

        let state = await session.state
        let pending = await session.pendingFrontendCalls()
        XCTAssertTrue(pending.isEmpty)
        XCTAssertTrue(lastAssistantText(state)?.contains("didn't advertise the open_task tool") == true)
    }

    func testRunErrorSurfacesAsErrorState() async throws {
        let session = ChatSession(
            transport: ScriptedTransport([try Fixtures.transcript("run_error.sse")])
        )
        await session.send("add a task to call the vet")

        let state = await session.state
        XCTAssertTrue(state.error?.contains("executor unreachable") == true)
        XCTAssertFalse(state.running)
    }
}

private actor ArgsRecorder {
    private(set) var args: [JSONValue] = []
    func record(_ value: JSONValue) { args.append(value) }
}
