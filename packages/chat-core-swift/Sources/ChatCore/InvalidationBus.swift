import struct Foundation.UUID

/// The mobile reconciliation seam (see /contracts/entity-events.md): chat
/// publishes every `entity_changed`; mounted screens subscribe filtered by the
/// scope(s) they render and refetch their own queries with a
/// `.fetchIgnoringCacheData` policy, which rewrites the normalized Apollo
/// cache and notifies watchers. Mirrors chat-core-kotlin's InvalidationBus.
public actor InvalidationBus {
    private var subscribers: [UUID: (scopes: Set<String>?, continuation: AsyncStream<EntityChanged>.Continuation)] = [:]

    public init() {}

    /// Changes relevant to a screen that renders the given scopes
    /// (nil = all changes, for diagnostics/logging).
    public func subscribe(scopes: Set<String>? = nil) -> AsyncStream<EntityChanged> {
        let id = UUID()
        let (stream, continuation) = AsyncStream.makeStream(
            of: EntityChanged.self,
            bufferingPolicy: .bufferingNewest(64)
        )
        continuation.onTermination = { _ in
            Task { await self.remove(id) }
        }
        subscribers[id] = (scopes, continuation)
        return stream
    }

    public func publish(_ change: EntityChanged) {
        for (_, subscriber) in subscribers {
            if subscriber.scopes == nil || subscriber.scopes!.contains(change.scope) {
                subscriber.continuation.yield(change)
            }
        }
    }

    private func remove(_ id: UUID) {
        subscribers.removeValue(forKey: id)
    }
}
