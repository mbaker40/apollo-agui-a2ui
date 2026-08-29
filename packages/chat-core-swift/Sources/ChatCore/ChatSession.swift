import Foundation

public struct ChatState: Equatable, Sendable {
    public var messages: [Message] = []
    public var running = false
    public var error: String?

    public init() {}
}

/// The shared event→action state machine, identical in responsibility to the
/// web ChatController and the Kotlin ChatSession:
///
/// - applies streamed events to a message list (text deltas, tool calls, results),
/// - publishes `entity_changed` CUSTOM events on the `InvalidationBus`,
/// - surfaces RUN_ERROR as an error state,
/// - runs the frontend-tool loop: a run that ends on a registered tool call
///   without a result gets the tool executed locally, the result appended as a
///   tool message, and a continuation run started (/contracts/frontend-tools.md).
public actor ChatSession {
    public private(set) var state = ChatState()
    public let bus: InvalidationBus

    private let transport: AgUiTransport
    private let frontendTools: FrontendToolRegistry
    private let threadId: String
    private let generateId: @Sendable (String) -> String
    private var openToolCalls: [String: (name: String, parentMessageId: String?, args: String)] = [:]
    private var stateObservers: [UUID: AsyncStream<ChatState>.Continuation] = [:]

    private static let maxContinuations = 4

    public init(
        transport: AgUiTransport,
        frontendTools: FrontendToolRegistry = FrontendToolRegistry(),
        bus: InvalidationBus = InvalidationBus(),
        threadId: String = "thread_\(UUID().uuidString)",
        generateId: @escaping @Sendable (String) -> String = { "\($0)_\(UUID().uuidString)" }
    ) {
        self.transport = transport
        self.frontendTools = frontendTools
        self.bus = bus
        self.threadId = threadId
        self.generateId = generateId
    }

    /// Observe state snapshots (UI layers wrap this in ObservableObject/@Observable).
    public func states() -> AsyncStream<ChatState> {
        let id = UUID()
        let (stream, continuation) = AsyncStream.makeStream(
            of: ChatState.self, bufferingPolicy: .bufferingNewest(1)
        )
        continuation.onTermination = { _ in
            Task { await self.removeObserver(id) }
        }
        stateObservers[id] = continuation
        continuation.yield(state)
        return stream
    }

    public func send(_ text: String) async {
        guard !state.running, !text.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        state.messages.append(.user(UserMessage(id: generateId("user"), content: text)))
        publish { $0.running = true; $0.error = nil }

        do {
            var hops = 0
            while hops <= Self.maxContinuations {
                hops += 1
                try await runOnce()
                let pending = pendingFrontendCalls()
                if pending.isEmpty { break }
                for call in pending {
                    let result = await executeFrontendTool(call)
                    state.messages.append(
                        .tool(ToolMessage(id: "tool_\(call.id)", toolCallId: call.id, content: result))
                    )
                }
                publish { _ in }
            }
        } catch {
            publish { $0.error = "\(error)" }
        }
        publish { $0.running = false }
    }

    private func runOnce() async throws {
        let input = RunAgentInput(
            threadId: threadId,
            runId: generateId("run"),
            messages: state.messages,
            tools: frontendTools.declarations
        )
        for try await event in transport.run(input) {
            await apply(event)
        }
    }

    /// Applies one AG-UI event to the local conversation state.
    public func apply(_ event: AgUiEvent) async {
        switch event {
        case let .textMessageStart(messageId):
            state.messages.append(.assistant(AssistantMessage(id: messageId, content: "")))
        case let .textMessageContent(messageId, delta):
            updateAssistant(id: messageId) { $0.content = ($0.content ?? "") + delta }
        case .textMessageEnd, .runStarted, .runFinished, .unknown:
            break
        case let .toolCallStart(toolCallId, toolCallName, parentMessageId):
            openToolCalls[toolCallId] = (toolCallName, parentMessageId, "")
        case let .toolCallArgs(toolCallId, delta):
            openToolCalls[toolCallId]?.args += delta
        case let .toolCallEnd(toolCallId):
            guard let open = openToolCalls.removeValue(forKey: toolCallId) else { break }
            let call = ToolCall(
                id: toolCallId, function: FunctionCall(name: open.name, arguments: open.args)
            )
            let parentId = open.parentMessageId ?? generateId("msg")
            if !appendToolCallToAssistant(parentId: parentId, call: call) {
                state.messages.append(.assistant(AssistantMessage(id: parentId, toolCalls: [call])))
            }
        case let .toolCallResult(messageId, toolCallId, content):
            state.messages.append(
                .tool(ToolMessage(id: messageId, toolCallId: toolCallId, content: content))
            )
        case let .custom(name, value):
            if name == entityChangedEventName,
               let data = try? JSONEncoder().encode(value),
               let change = try? JSONDecoder().decode(EntityChanged.self, from: data) {
                await bus.publish(change)
            }
        case let .runError(message, _):
            publish { $0.error = message }
        }
        publish { _ in }
    }

    /// Registered frontend tool calls that have no tool-result message yet.
    public func pendingFrontendCalls() -> [ToolCall] {
        var answered = Set<String>()
        for case let .tool(message) in state.messages {
            answered.insert(message.toolCallId)
        }
        var pending: [ToolCall] = []
        for case let .assistant(message) in state.messages {
            for call in message.toolCalls ?? []
                where frontendTools.contains(call.function.name) && !answered.contains(call.id) {
                pending.append(call)
            }
        }
        return pending
    }

    private func executeFrontendTool(_ call: ToolCall) async -> String {
        guard let tool = frontendTools[call.function.name] else {
            return #"{"error":"frontend tool '\#(call.function.name)' is not registered"}"#
        }
        let args = (try? JSONValue.parse(call.function.arguments.isEmpty ? "{}" : call.function.arguments))
            ?? .object([:])
        do {
            return try await tool.execute(args).encodedString()
        } catch {
            return (try? JSONValue.object(["error": .string("\(error)")]).encodedString())
                ?? #"{"error":"tool failed"}"#
        }
    }

    private func updateAssistant(id: String, _ transform: (inout AssistantMessage) -> Void) {
        for index in state.messages.indices.reversed() {
            if case var .assistant(message) = state.messages[index], message.id == id {
                transform(&message)
                state.messages[index] = .assistant(message)
                return
            }
        }
    }

    private func appendToolCallToAssistant(parentId: String, call: ToolCall) -> Bool {
        for index in state.messages.indices.reversed() {
            if case var .assistant(message) = state.messages[index], message.id == parentId {
                message.toolCalls = (message.toolCalls ?? []) + [call]
                state.messages[index] = .assistant(message)
                return true
            }
        }
        return false
    }

    private func publish(_ transform: (inout ChatState) -> Void) {
        transform(&state)
        for (_, continuation) in stateObservers {
            continuation.yield(state)
        }
    }

    private func removeObserver(_ id: UUID) {
        stateObservers.removeValue(forKey: id)
    }
}
