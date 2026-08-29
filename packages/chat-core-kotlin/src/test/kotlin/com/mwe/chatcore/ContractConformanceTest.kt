package com.mwe.chatcore

import kotlinx.serialization.json.Json
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/** Pins this platform to the shared /contracts fixtures. */
class ContractConformanceTest {
    @Test
    fun `entity_changed fixtures parse and round-trip`() {
        val expected =
            mapOf(
                "created" to EntityChanged.Kind.CREATED,
                "updated" to EntityChanged.Kind.UPDATED,
                "deleted" to EntityChanged.Kind.DELETED,
            )
        for ((name, kind) in expected) {
            val raw = Fixtures.json("entity-changed/$name.json")
            val parsed = AgUiJson.decodeFromString(EntityChanged.serializer(), raw)
            assertEquals(EntityChanged("Task", "task_0001", kind, "tasks"), parsed)
            assertEquals(
                Json.parseToJsonElement(raw),
                AgUiJson.encodeToJsonElement(EntityChanged.serializer(), parsed),
            )
        }
    }

    @Test
    fun `open_task declaration matches the canonical fixture exactly`() {
        val raw = Fixtures.json("frontend-tools/open-task.json")
        val parsed = AgUiJson.decodeFromString(ToolDefinition.serializer(), raw)
        assertEquals(StandardFrontendTools.OPEN_TASK, parsed)
        assertEquals(
            Json.parseToJsonElement(raw),
            AgUiJson.encodeToJsonElement(ToolDefinition.serializer(), StandardFrontendTools.OPEN_TASK),
        )
    }
}
