package com.mwe.chatcore

import kotlinx.serialization.json.Json
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** Scenario 5 (handoff §4): recorded real-agent SSE transcripts parse into the core's model. */
class TranscriptParsingTest {
    private fun types(events: List<AgUiEvent>) = events.map { it.type }

    @Test
    fun `create_task transcript - full backend-write event sequence`() {
        val events = SseParser.parseTranscript(Fixtures.transcript("create_task.sse"))
        assertEquals(
            listOf(
                "RUN_STARTED",
                "TOOL_CALL_START",
                "TOOL_CALL_ARGS",
                "TOOL_CALL_END",
                "TOOL_CALL_RESULT",
                "CUSTOM",
                "TEXT_MESSAGE_START",
                "TEXT_MESSAGE_CONTENT",
                "TEXT_MESSAGE_CONTENT",
                "TEXT_MESSAGE_CONTENT",
                "TEXT_MESSAGE_END",
                "RUN_FINISHED",
            ),
            types(events),
        )

        val start = events[1] as AgUiEvent.ToolCallStart
        assertEquals("create_task", start.toolCallName)

        val custom = events[5] as AgUiEvent.Custom
        assertEquals(ENTITY_CHANGED_EVENT, custom.name)
        val payload = AgUiJson.decodeFromJsonElement(EntityChanged.serializer(), custom.value)
        assertEquals(
            EntityChanged("Task", "task_0001", EntityChanged.Kind.CREATED, "tasks"),
            payload,
        )
        // And the payload matches the canonical cross-platform fixture byte-for-byte as JSON.
        assertEquals(
            Json.parseToJsonElement(Fixtures.json("entity-changed/created.json")),
            custom.value,
        )

        val text =
            events.filterIsInstance<AgUiEvent.TextMessageContent>().joinToString("") { it.delta }
        assertEquals("Created \"buy milk\" (task_0001). Anything else?", text)
    }

    @Test
    fun `complete_task transcript - read-then-write emits UPDATED`() {
        val events = SseParser.parseTranscript(Fixtures.transcript("complete_task.sse"))
        val toolNames = events.filterIsInstance<AgUiEvent.ToolCallStart>().map { it.toolCallName }
        assertEquals(listOf("list_tasks", "complete_task"), toolNames)

        val customs = events.filterIsInstance<AgUiEvent.Custom>()
        assertEquals(1, customs.size)
        assertEquals(
            EntityChanged("Task", "task_0001", EntityChanged.Kind.UPDATED, "tasks"),
            AgUiJson.decodeFromJsonElement(EntityChanged.serializer(), customs[0].value),
        )
    }

    @Test
    fun `open_task_deferred transcript - frontend call has no result and run finishes`() {
        val events = SseParser.parseTranscript(Fixtures.transcript("open_task_deferred.sse"))
        val starts = events.filterIsInstance<AgUiEvent.ToolCallStart>()
        assertEquals(listOf("list_tasks", "open_task"), starts.map { it.toolCallName })

        val openCallId = starts[1].toolCallId
        val results = events.filterIsInstance<AgUiEvent.ToolCallResult>()
        assertEquals(1, results.size)
        assertTrue(results.none { it.toolCallId == openCallId })
        assertEquals("RUN_FINISHED", events.last().type)
        assertTrue(events.filterIsInstance<AgUiEvent.TextMessageContent>().isEmpty())
    }

    @Test
    fun `run_error transcript - executor down surfaces RUN_ERROR`() {
        val events = SseParser.parseTranscript(Fixtures.transcript("run_error.sse"))
        val error = events.last() as AgUiEvent.RunError
        assertTrue(error.message.contains("executor unreachable"))
    }
}
