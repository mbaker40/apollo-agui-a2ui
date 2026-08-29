package com.mwe.chatcore

import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonContentPolymorphicSerializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * The AG-UI events this MWE consumes, discriminated by `type`. Anything else
 * (thinking/reasoning/state/… events from richer agents) parses as [Unknown]
 * and is ignored by the state machine instead of crashing the stream.
 */
@Serializable(with = AgUiEventSerializer::class)
sealed interface AgUiEvent {
    val type: String

    @Serializable
    data class RunStarted(
        val threadId: String,
        val runId: String,
        override val type: String = "RUN_STARTED",
    ) : AgUiEvent

    @Serializable
    data class RunFinished(
        val threadId: String,
        val runId: String,
        val result: JsonElement? = null,
        override val type: String = "RUN_FINISHED",
    ) : AgUiEvent

    @Serializable
    data class RunError(
        val message: String,
        val code: String? = null,
        override val type: String = "RUN_ERROR",
    ) : AgUiEvent

    @Serializable
    data class TextMessageStart(
        val messageId: String,
        val role: String? = null,
        override val type: String = "TEXT_MESSAGE_START",
    ) : AgUiEvent

    @Serializable
    data class TextMessageContent(
        val messageId: String,
        val delta: String,
        override val type: String = "TEXT_MESSAGE_CONTENT",
    ) : AgUiEvent

    @Serializable
    data class TextMessageEnd(
        val messageId: String,
        override val type: String = "TEXT_MESSAGE_END",
    ) : AgUiEvent

    @Serializable
    data class ToolCallStart(
        val toolCallId: String,
        val toolCallName: String,
        val parentMessageId: String? = null,
        override val type: String = "TOOL_CALL_START",
    ) : AgUiEvent

    @Serializable
    data class ToolCallArgs(
        val toolCallId: String,
        val delta: String,
        override val type: String = "TOOL_CALL_ARGS",
    ) : AgUiEvent

    @Serializable
    data class ToolCallEnd(
        val toolCallId: String,
        override val type: String = "TOOL_CALL_END",
    ) : AgUiEvent

    @Serializable
    data class ToolCallResult(
        val messageId: String,
        val toolCallId: String,
        val content: String,
        val role: String? = null,
        override val type: String = "TOOL_CALL_RESULT",
    ) : AgUiEvent

    @Serializable
    data class Custom(
        val name: String,
        val value: JsonElement,
        override val type: String = "CUSTOM",
    ) : AgUiEvent

    @Serializable
    data class Unknown(
        override val type: String,
    ) : AgUiEvent
}

object AgUiEventSerializer : JsonContentPolymorphicSerializer<AgUiEvent>(AgUiEvent::class) {
    override fun selectDeserializer(element: JsonElement): DeserializationStrategy<AgUiEvent> =
        when (element.jsonObject["type"]?.jsonPrimitive?.content) {
            "RUN_STARTED" -> AgUiEvent.RunStarted.serializer()
            "RUN_FINISHED" -> AgUiEvent.RunFinished.serializer()
            "RUN_ERROR" -> AgUiEvent.RunError.serializer()
            "TEXT_MESSAGE_START" -> AgUiEvent.TextMessageStart.serializer()
            "TEXT_MESSAGE_CONTENT" -> AgUiEvent.TextMessageContent.serializer()
            "TEXT_MESSAGE_END" -> AgUiEvent.TextMessageEnd.serializer()
            "TOOL_CALL_START" -> AgUiEvent.ToolCallStart.serializer()
            "TOOL_CALL_ARGS" -> AgUiEvent.ToolCallArgs.serializer()
            "TOOL_CALL_END" -> AgUiEvent.ToolCallEnd.serializer()
            "TOOL_CALL_RESULT" -> AgUiEvent.ToolCallResult.serializer()
            "CUSTOM" -> AgUiEvent.Custom.serializer()
            else -> AgUiEvent.Unknown.serializer()
        }
}
