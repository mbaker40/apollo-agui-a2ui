package com.mwe.chatcore

import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonContentPolymorphicSerializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Conversation messages, discriminated by `role` on the wire (OpenAI-style, per AG-UI). */
@Serializable(with = MessageSerializer::class)
sealed interface Message {
    val id: String
    val role: String
}

@Serializable
data class UserMessage(
    override val id: String,
    val content: String,
    override val role: String = "user",
) : Message

@Serializable
data class AssistantMessage(
    override val id: String,
    val content: String? = null,
    val toolCalls: List<ToolCall>? = null,
    override val role: String = "assistant",
) : Message

@Serializable
data class ToolMessage(
    override val id: String,
    val toolCallId: String,
    val content: String,
    override val role: String = "tool",
) : Message

/** Roles this MWE core does not act on (system/developer/…): parsed, kept, ignored. */
@Serializable
data class OtherMessage(
    override val id: String,
    override val role: String,
    val content: String? = null,
) : Message

object MessageSerializer : JsonContentPolymorphicSerializer<Message>(Message::class) {
    override fun selectDeserializer(element: JsonElement): DeserializationStrategy<Message> =
        when (element.jsonObject["role"]?.jsonPrimitive?.content) {
            "user" -> UserMessage.serializer()
            "assistant" -> AssistantMessage.serializer()
            "tool" -> ToolMessage.serializer()
            else -> OtherMessage.serializer()
        }
}

@Serializable
data class ToolCall(
    val id: String,
    val function: FunctionCall,
    val type: String = "function",
)

@Serializable
data class FunctionCall(
    val name: String,
    val arguments: String,
)

/** A client-declared tool, sent in RunAgentInput.tools — see /contracts/frontend-tools.md. */
@Serializable
data class ToolDefinition(
    val name: String,
    val description: String,
    val parameters: JsonObject,
)

@Serializable
data class RunAgentInput(
    val threadId: String,
    val runId: String,
    val messages: List<Message>,
    val tools: List<ToolDefinition> = emptyList(),
    val context: List<JsonElement> = emptyList(),
    val state: JsonElement? = null,
    val forwardedProps: JsonElement? = null,
)
