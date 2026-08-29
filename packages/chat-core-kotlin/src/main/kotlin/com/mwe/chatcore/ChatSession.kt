package com.mwe.chatcore

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import java.util.UUID

data class ChatState(
    val messages: List<Message> = emptyList(),
    val running: Boolean = false,
    val error: String? = null,
)

/**
 * The shared event→action state machine, identical in responsibility to the
 * web ChatController and the Swift ChatSession:
 *
 * - applies streamed events to a message list (text deltas, tool calls, results),
 * - publishes `entity_changed` CUSTOM events on the [InvalidationBus],
 * - surfaces RUN_ERROR as an error state,
 * - runs the frontend-tool loop: a run that ends on a registered tool call
 *   without a result gets the tool executed locally, the result appended as a
 *   tool message, and a continuation run started (/contracts/frontend-tools.md).
 */
class ChatSession(
    private val transport: AgUiTransport,
    private val frontendTools: FrontendToolRegistry = FrontendToolRegistry(),
    val bus: InvalidationBus = InvalidationBus(),
    private val threadId: String = "thread_${UUID.randomUUID()}",
    private val generateId: (prefix: String) -> String = { prefix ->
        "${prefix}_${UUID.randomUUID()}"
    },
) {
    private val _state = MutableStateFlow(ChatState())
    val state: StateFlow<ChatState> = _state.asStateFlow()

    private val messages = mutableListOf<Message>()
    private val openToolCalls = mutableMapOf<String, OpenToolCall>()

    private data class OpenToolCall(
        val name: String,
        val parentMessageId: String?,
        val args: StringBuilder = StringBuilder(),
    )

    suspend fun send(text: String) {
        if (_state.value.running || text.isBlank()) return
        messages += UserMessage(id = generateId("user"), content = text)
        publish { copy(running = true, error = null) }

        try {
            var hops = 0
            while (hops <= MAX_CONTINUATIONS) {
                hops += 1
                runOnce()
                val pending = pendingFrontendCalls()
                if (pending.isEmpty()) break
                for (call in pending) {
                    val result = executeFrontendTool(call)
                    messages +=
                        ToolMessage(
                            id = "tool_${call.id}",
                            toolCallId = call.id,
                            content = result,
                        )
                }
                publish { copy() }
            }
        } catch (e: AgUiHttpException) {
            publish { copy(error = e.message) }
        } catch (e: java.io.IOException) {
            publish { copy(error = "agent unreachable: ${e.message}") }
        } finally {
            publish { copy(running = false) }
        }
    }

    private suspend fun runOnce() {
        val input =
            RunAgentInput(
                threadId = threadId,
                runId = generateId("run"),
                messages = messages.toList(),
                tools = frontendTools.declarations,
            )
        transport.run(input).collect { event -> apply(event) }
    }

    /** Applies one AG-UI event to the local conversation state. */
    fun apply(event: AgUiEvent) {
        when (event) {
            is AgUiEvent.TextMessageStart ->
                messages += AssistantMessage(id = event.messageId, content = "")
            is AgUiEvent.TextMessageContent ->
                updateAssistant(event.messageId) { it.copy(content = (it.content ?: "") + event.delta) }
            is AgUiEvent.TextMessageEnd -> Unit
            is AgUiEvent.ToolCallStart ->
                openToolCalls[event.toolCallId] =
                    OpenToolCall(name = event.toolCallName, parentMessageId = event.parentMessageId)
            is AgUiEvent.ToolCallArgs -> openToolCalls[event.toolCallId]?.args?.append(event.delta)
            is AgUiEvent.ToolCallEnd -> {
                val open = openToolCalls.remove(event.toolCallId) ?: return
                val call =
                    ToolCall(
                        id = event.toolCallId,
                        function = FunctionCall(name = open.name, arguments = open.args.toString()),
                    )
                val parentId = open.parentMessageId ?: generateId("msg")
                val parentIndex = messages.indexOfLast { it.id == parentId && it is AssistantMessage }
                if (parentIndex >= 0) {
                    val parent = messages[parentIndex] as AssistantMessage
                    messages[parentIndex] = parent.copy(toolCalls = (parent.toolCalls ?: emptyList()) + call)
                } else {
                    messages += AssistantMessage(id = parentId, toolCalls = listOf(call))
                }
            }
            is AgUiEvent.ToolCallResult ->
                messages +=
                    ToolMessage(id = event.messageId, toolCallId = event.toolCallId, content = event.content)
            is AgUiEvent.Custom -> {
                if (event.name == ENTITY_CHANGED_EVENT) {
                    runCatching {
                        AgUiJson.decodeFromJsonElement(EntityChanged.serializer(), event.value)
                    }.onSuccess { bus.publish(it) }
                }
            }
            is AgUiEvent.RunError -> publish { copy(error = event.message) }
            is AgUiEvent.RunStarted, is AgUiEvent.RunFinished, is AgUiEvent.Unknown -> Unit
        }
        publish { copy() }
    }

    private fun updateAssistant(
        messageId: String,
        transform: (AssistantMessage) -> AssistantMessage,
    ) {
        val index = messages.indexOfLast { it.id == messageId && it is AssistantMessage }
        if (index >= 0) messages[index] = transform(messages[index] as AssistantMessage)
    }

    /** Registered frontend tool calls that have no tool-result message yet. */
    fun pendingFrontendCalls(): List<ToolCall> {
        val answered = messages.filterIsInstance<ToolMessage>().map { it.toolCallId }.toSet()
        return messages
            .filterIsInstance<AssistantMessage>()
            .flatMap { it.toolCalls.orEmpty() }
            .filter { it.function.name in frontendTools && it.id !in answered }
    }

    private suspend fun executeFrontendTool(call: ToolCall): String {
        val tool =
            frontendTools[call.function.name]
                ?: return """{"error":"frontend tool '${call.function.name}' is not registered"}"""
        val args =
            runCatching { Json.parseToJsonElement(call.function.arguments.ifBlank { "{}" }).jsonObject }
                .getOrElse { JsonObject(emptyMap()) }
        return runCatching { tool.execute(args) }
            .map {
                AgUiJson.encodeToString(
                    kotlinx.serialization.json.JsonElement
                        .serializer(),
                    it,
                )
            }.getOrElse { e ->
                AgUiJson.encodeToString(
                    JsonObject.serializer(),
                    buildJsonObject { put("error", JsonPrimitive(e.message ?: "tool failed")) },
                )
            }
    }

    private fun publish(transform: ChatState.() -> ChatState) {
        _state.value = _state.value.transform().copy(messages = messages.toList())
    }

    private companion object {
        const val MAX_CONTINUATIONS = 4
    }
}
