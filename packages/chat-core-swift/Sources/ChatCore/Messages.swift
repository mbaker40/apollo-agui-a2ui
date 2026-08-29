import Foundation

/// Conversation messages, discriminated by `role` on the wire (OpenAI-style, per AG-UI).
public enum Message: Codable, Equatable, Sendable {
    case user(UserMessage)
    case assistant(AssistantMessage)
    case tool(ToolMessage)
    /// Roles this MWE core does not act on (system/developer/…): parsed, kept, ignored.
    case other(id: String, role: String)

    public var id: String {
        switch self {
        case let .user(message): message.id
        case let .assistant(message): message.id
        case let .tool(message): message.id
        case let .other(id, _): id
        }
    }

    private enum CodingKeys: String, CodingKey {
        case id, role
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .role) {
        case "user": self = try .user(UserMessage(from: decoder))
        case "assistant": self = try .assistant(AssistantMessage(from: decoder))
        case "tool": self = try .tool(ToolMessage(from: decoder))
        case let role: self = try .other(id: container.decode(String.self, forKey: .id), role: role)
        }
    }

    public func encode(to encoder: Encoder) throws {
        switch self {
        case let .user(message): try message.encode(to: encoder)
        case let .assistant(message): try message.encode(to: encoder)
        case let .tool(message): try message.encode(to: encoder)
        case let .other(id, role):
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(id, forKey: .id)
            try container.encode(role, forKey: .role)
        }
    }
}

public struct UserMessage: Codable, Equatable, Sendable {
    public var id: String
    public var content: String
    public var role: String = "user"

    public init(id: String, content: String) {
        self.id = id
        self.content = content
    }
}

public struct AssistantMessage: Codable, Equatable, Sendable {
    public var id: String
    public var content: String?
    public var toolCalls: [ToolCall]?
    public var role: String = "assistant"

    public init(id: String, content: String? = nil, toolCalls: [ToolCall]? = nil) {
        self.id = id
        self.content = content
        self.toolCalls = toolCalls
    }
}

public struct ToolMessage: Codable, Equatable, Sendable {
    public var id: String
    public var toolCallId: String
    public var content: String
    public var role: String = "tool"

    public init(id: String, toolCallId: String, content: String) {
        self.id = id
        self.toolCallId = toolCallId
        self.content = content
    }
}

public struct ToolCall: Codable, Equatable, Sendable {
    public var id: String
    public var function: FunctionCall
    public var type: String = "function"

    public init(id: String, function: FunctionCall) {
        self.id = id
        self.function = function
    }
}

public struct FunctionCall: Codable, Equatable, Sendable {
    public var name: String
    public var arguments: String

    public init(name: String, arguments: String) {
        self.name = name
        self.arguments = arguments
    }
}

/// A client-declared tool, sent in RunAgentInput.tools — see /contracts/frontend-tools.md.
public struct ToolDefinition: Codable, Equatable, Sendable {
    public var name: String
    public var description: String
    public var parameters: JSONValue

    public init(name: String, description: String, parameters: JSONValue) {
        self.name = name
        self.description = description
        self.parameters = parameters
    }
}

public struct RunAgentInput: Codable, Equatable, Sendable {
    public var threadId: String
    public var runId: String
    public var messages: [Message]
    public var tools: [ToolDefinition]
    /// context, state, and forwardedProps are REQUIRED keys in the AG-UI
    /// RunAgentInput (the Python SDK rejects a body missing context or
    /// forwardedProps), so they always encode — as [], null, null by default.
    public var context: [JSONValue]
    public var state: JSONValue
    public var forwardedProps: JSONValue

    public init(
        threadId: String,
        runId: String,
        messages: [Message],
        tools: [ToolDefinition] = [],
        context: [JSONValue] = [],
        state: JSONValue = .null,
        forwardedProps: JSONValue = .null
    ) {
        self.threadId = threadId
        self.runId = runId
        self.messages = messages
        self.tools = tools
        self.context = context
        self.state = state
        self.forwardedProps = forwardedProps
    }
}
