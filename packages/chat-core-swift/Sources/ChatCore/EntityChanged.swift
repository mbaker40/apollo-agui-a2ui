/// Payload of the AG-UI CUSTOM `entity_changed` event — see /contracts/entity-events.md.
public struct EntityChanged: Codable, Equatable, Sendable {
    public enum Kind: String, Codable, Sendable {
        case created = "CREATED"
        case updated = "UPDATED"
        case deleted = "DELETED"
    }

    public let typename: String
    public let id: String
    public let kind: Kind
    public let scope: String

    public init(typename: String, id: String, kind: Kind, scope: String) {
        self.typename = typename
        self.id = id
        self.kind = kind
        self.scope = scope
    }
}

public let entityChangedEventName = "entity_changed"
