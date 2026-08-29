import Apollo
import ApolloAPI
import ChatCore
import Foundation
import MweGraphQL

/// The thin shell: Apollo iOS wiring + observable state. Everything
/// protocol-shaped (SSE, events, tool loop, bus) lives in chat-core-swift,
/// which is what `swift test` covers.
@MainActor
final class AppModel: ObservableObject {
    struct TaskRow: Identifiable, Equatable {
        let id: String
        let title: String
        let completed: Bool
    }

    @Published var tasks: [TaskRow] = []
    @Published var chat = ChatState()
    @Published var selectedTaskId: String?

    private let apollo: ApolloClient
    private var session: ChatSession!
    private var watcher: GraphQLQueryWatcher<MweGraphQL.TasksQuery>?

    init() {
        let store = ApolloStore(cache: InMemoryNormalizedCache())
        let transport = RequestChainNetworkTransport(
            interceptorProvider: DefaultInterceptorProvider(store: store),
            endpointURL: Config.graphqlURL,
            additionalHeaders: ["authorization": "Bearer \(Config.devJWT)"]
        )
        apollo = ApolloClient(networkTransport: transport, store: store)

        session = ChatSession(
            transport: URLSessionAgUiTransport(url: Config.agentURL, bearerToken: Config.devJWT),
            frontendTools: FrontendToolRegistry([
                FrontendTool(declaration: StandardFrontendTools.openTask) { [weak self] args in
                    await self?.openTask(args: args) ?? .object(["status": .string("not_found")])
                },
            ])
        )

        // Watch the normalized cache: any cache rewrite re-emits the query.
        watcher = apollo.watch(query: MweGraphQL.TasksQuery()) { [weak self] result in
            guard case let .success(response) = result, let data = response.data else { return }
            Task { @MainActor in
                self?.tasks = data.tasks.map {
                    TaskRow(id: $0.id, title: $0.title, completed: $0.completed)
                }
            }
        }

        // Mirror chat state into SwiftUI.
        Task { [session] in
            guard let session else { return }
            for await state in await session.states() {
                self.chat = state
            }
        }

        // THE reconciliation seam (contracts/entity-events.md): chat publishes
        // entity_changed → this screen refetches ITS OWN query ignoring the
        // cache, which rewrites the store and notifies the watcher above.
        Task { [session] in
            guard let session else { return }
            let changes = await session.bus.subscribe(scopes: ["tasks"])
            for await _ in changes {
                self.apollo.fetch(query: MweGraphQL.TasksQuery(), cachePolicy: .fetchIgnoringCacheData)
            }
        }
    }

    func send(_ text: String) {
        Task { [session] in await session?.send(text) }
    }

    private func openTask(args: JSONValue) -> JSONValue {
        let id = args["id"]?.stringValue ?? ""
        let exists = tasks.contains { $0.id == id }
        if exists { selectedTaskId = id }
        return .object(["status": .string(exists ? "opened" : "not_found"), "id": .string(id)])
    }
}
