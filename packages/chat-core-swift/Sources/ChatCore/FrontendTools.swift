/// A client-local tool: declared to the agent, executed on this device.
public struct FrontendTool: Sendable {
    public let declaration: ToolDefinition
    public let execute: @Sendable (_ args: JSONValue) async throws -> JSONValue

    public init(
        declaration: ToolDefinition,
        execute: @escaping @Sendable (_ args: JSONValue) async throws -> JSONValue
    ) {
        self.declaration = declaration
        self.execute = execute
    }
}

public struct FrontendToolRegistry: Sendable {
    private let byName: [String: FrontendTool]

    public init(_ tools: [FrontendTool] = []) {
        byName = Dictionary(uniqueKeysWithValues: tools.map { ($0.declaration.name, $0) })
    }

    public var declarations: [ToolDefinition] {
        byName.values.map(\.declaration).sorted { $0.name < $1.name }
    }

    public func contains(_ name: String) -> Bool { byName[name] != nil }

    public subscript(name: String) -> FrontendTool? { byName[name] }
}

/// Canonical frontend-tool declarations, mirroring
/// /contracts/fixtures/frontend-tools/. Pinned by ContractConformanceTests so
/// a drifting declaration fails the build instead of silently forking
/// behavior across clients.
public enum StandardFrontendTools {
    public static let openTask = ToolDefinition(
        name: "open_task",
        description: "Open the task with the given id in the client UI so the user can see it. "
            + "Only call this when the current run declared it.",
        parameters: .object([
            "type": .string("object"),
            "additionalProperties": .bool(false),
            "required": .array([.string("id")]),
            "properties": .object([
                "id": .object([
                    "type": .string("string"),
                    "description": .string("Id of the task to open"),
                ]),
            ]),
        ])
    )
}
