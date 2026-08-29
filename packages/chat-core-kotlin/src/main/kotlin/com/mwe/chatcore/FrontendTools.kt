package com.mwe.chatcore

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/** A client-local tool: declared to the agent, executed on this device. */
class FrontendTool(
    val declaration: ToolDefinition,
    val execute: suspend (args: JsonObject) -> JsonElement,
)

class FrontendToolRegistry(
    tools: List<FrontendTool> = emptyList(),
) {
    private val byName = tools.associateBy { it.declaration.name }

    val declarations: List<ToolDefinition> get() = byName.values.map { it.declaration }

    operator fun contains(name: String): Boolean = name in byName

    operator fun get(name: String): FrontendTool? = byName[name]
}
