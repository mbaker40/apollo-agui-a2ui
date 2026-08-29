package com.mwe.chatcore

import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject

/**
 * Canonical frontend-tool declarations, mirroring
 * /contracts/fixtures/frontend-tools/. Pinned by ContractConformanceTest so a
 * drifting declaration fails the build instead of silently forking behavior
 * across clients.
 */
object StandardFrontendTools {
    val OPEN_TASK: ToolDefinition =
        ToolDefinition(
            name = "open_task",
            description =
                "Open the task with the given id in the client UI so the user can see it. " +
                    "Only call this when the current run declared it.",
            parameters =
                buildJsonObject {
                    put("type", JsonPrimitive("object"))
                    put("additionalProperties", JsonPrimitive(false))
                    put("required", buildJsonArray { add(JsonPrimitive("id")) })
                    put(
                        "properties",
                        buildJsonObject {
                            put(
                                "id",
                                buildJsonObject {
                                    put("type", JsonPrimitive("string"))
                                    put("description", JsonPrimitive("Id of the task to open"))
                                },
                            )
                        },
                    )
                },
        )
}
