import ChatCore
import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var model: AppModel
    @State private var draft = ""

    var body: some View {
        VStack(spacing: 8) {
            Text("MWE Tasks").font(.headline)

            // Task list: refreshed via bus-driven cache-ignoring refetch, no reload.
            List(model.tasks) { task in
                HStack {
                    Text(task.completed ? "✓" : "○")
                    Text(task.title).strikethrough(task.completed)
                    Spacer()
                    Text(task.id).font(.caption2).foregroundStyle(.secondary)
                }
                .listRowBackground(
                    task.id == model.selectedTaskId ? Color.blue.opacity(0.15) : Color.clear
                )
            }
            .frame(maxHeight: 260)

            // Chat transcript (assistant text + tool-call chips as plain rows).
            ScrollView {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(model.chat.messages.enumerated()), id: \.offset) { _, message in
                        MessageRow(message: message)
                    }
                    if let error = model.chat.error {
                        Text("Run failed: \(error)").foregroundStyle(.red).font(.caption)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal)
            }

            HStack {
                TextField("add a task to buy milk", text: $draft)
                    .textFieldStyle(.roundedBorder)
                    .disabled(model.chat.running)
                Button(model.chat.running ? "…" : "Send") {
                    model.send(draft)
                    draft = ""
                }
                .disabled(model.chat.running || draft.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding([.horizontal, .bottom])
        }
    }
}

private struct MessageRow: View {
    let message: Message

    var body: some View {
        switch message {
        case let .user(user):
            Text("You: \(user.content)")
        case let .assistant(assistant):
            VStack(alignment: .leading, spacing: 2) {
                ForEach(assistant.toolCalls ?? [], id: \.id) { call in
                    Text("⚙ \(call.function.name)(\(call.function.arguments))")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                if let content = assistant.content, !content.isEmpty {
                    Text("Agent: \(content)")
                }
            }
        default:
            EmptyView()
        }
    }
}
