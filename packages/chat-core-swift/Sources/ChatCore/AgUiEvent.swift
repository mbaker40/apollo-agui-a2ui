import Foundation

/// The AG-UI events this MWE consumes, discriminated by `type`. Anything else
/// (thinking/reasoning/state/… events from richer agents) parses as `.unknown`
/// and is ignored by the state machine instead of crashing the stream.
public enum AgUiEvent: Equatable, Sendable {
    case runStarted(threadId: String, runId: String)
    case runFinished(threadId: String, runId: String)
    case runError(message: String, code: String?)
    case textMessageStart(messageId: String)
    case textMessageContent(messageId: String, delta: String)
    case textMessageEnd(messageId: String)
    case toolCallStart(toolCallId: String, toolCallName: String, parentMessageId: String?)
    case toolCallArgs(toolCallId: String, delta: String)
    case toolCallEnd(toolCallId: String)
    case toolCallResult(messageId: String, toolCallId: String, content: String)
    case custom(name: String, value: JSONValue)
    case unknown(type: String)

    public var type: String {
        switch self {
        case .runStarted: "RUN_STARTED"
        case .runFinished: "RUN_FINISHED"
        case .runError: "RUN_ERROR"
        case .textMessageStart: "TEXT_MESSAGE_START"
        case .textMessageContent: "TEXT_MESSAGE_CONTENT"
        case .textMessageEnd: "TEXT_MESSAGE_END"
        case .toolCallStart: "TOOL_CALL_START"
        case .toolCallArgs: "TOOL_CALL_ARGS"
        case .toolCallEnd: "TOOL_CALL_END"
        case .toolCallResult: "TOOL_CALL_RESULT"
        case .custom: "CUSTOM"
        case let .unknown(type): type
        }
    }
}

extension AgUiEvent: Decodable {
    private enum CodingKeys: String, CodingKey {
        case type, threadId, runId, message, code, messageId, delta
        case toolCallId, toolCallName, parentMessageId, content, name, value
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.decode(String.self, forKey: .type) {
        case "RUN_STARTED":
            self = try .runStarted(
                threadId: c.decode(String.self, forKey: .threadId),
                runId: c.decode(String.self, forKey: .runId)
            )
        case "RUN_FINISHED":
            self = try .runFinished(
                threadId: c.decode(String.self, forKey: .threadId),
                runId: c.decode(String.self, forKey: .runId)
            )
        case "RUN_ERROR":
            self = try .runError(
                message: c.decode(String.self, forKey: .message),
                code: c.decodeIfPresent(String.self, forKey: .code)
            )
        case "TEXT_MESSAGE_START":
            self = try .textMessageStart(messageId: c.decode(String.self, forKey: .messageId))
        case "TEXT_MESSAGE_CONTENT":
            self = try .textMessageContent(
                messageId: c.decode(String.self, forKey: .messageId),
                delta: c.decode(String.self, forKey: .delta)
            )
        case "TEXT_MESSAGE_END":
            self = try .textMessageEnd(messageId: c.decode(String.self, forKey: .messageId))
        case "TOOL_CALL_START":
            self = try .toolCallStart(
                toolCallId: c.decode(String.self, forKey: .toolCallId),
                toolCallName: c.decode(String.self, forKey: .toolCallName),
                parentMessageId: c.decodeIfPresent(String.self, forKey: .parentMessageId)
            )
        case "TOOL_CALL_ARGS":
            self = try .toolCallArgs(
                toolCallId: c.decode(String.self, forKey: .toolCallId),
                delta: c.decode(String.self, forKey: .delta)
            )
        case "TOOL_CALL_END":
            self = try .toolCallEnd(toolCallId: c.decode(String.self, forKey: .toolCallId))
        case "TOOL_CALL_RESULT":
            self = try .toolCallResult(
                messageId: c.decode(String.self, forKey: .messageId),
                toolCallId: c.decode(String.self, forKey: .toolCallId),
                content: c.decode(String.self, forKey: .content)
            )
        case "CUSTOM":
            self = try .custom(
                name: c.decode(String.self, forKey: .name),
                value: c.decode(JSONValue.self, forKey: .value)
            )
        case let other:
            self = .unknown(type: other)
        }
    }

    public static func decode(payload: String) throws -> AgUiEvent {
        try JSONDecoder().decode(AgUiEvent.self, from: Data(payload.utf8))
    }
}
