package com.mwe.chatcore

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.yield
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * v2 transcripts (bulk, DELETED, cross-scope) replayed through the UNCHANGED
 * core — the scaling claim in docs/SCALING.md: ten new server-side mutations
 * required zero edits to the event model, parser, session, or bus.
 */
class TranscriptParsingV2Test {
    private fun customs(events: List<AgUiEvent>) =
        events.filterIsInstance<AgUiEvent.Custom>().map {
            AgUiJson.decodeFromJsonElement(EntityChanged.serializer(), it.value)
        }

    @Test
    fun `delete_task transcript - the DELETED kind has a real producer`() {
        val events = SseParser.parseTranscript(Fixtures.transcript("delete_task.sse"))
        assertEquals(
            listOf(EntityChanged("Task", "task_0002", EntityChanged.Kind.DELETED, "tasks")),
            customs(events),
        )
    }

    @Test
    fun `clear_completed transcript - bulk emits one event per removed task`() {
        val events = SseParser.parseTranscript(Fixtures.transcript("clear_completed.sse"))
        val changes = customs(events)
        assertTrue(changes.isNotEmpty())
        assertTrue(changes.all { it.kind == EntityChanged.Kind.DELETED && it.scope == "tasks" })
        val text =
            events.filterIsInstance<AgUiEvent.TextMessageContent>().joinToString("") { it.delta }
        assertEquals("Cleared ${changes.size} completed task${if (changes.size == 1) "" else "s"}.", text)
    }

    @Test
    fun `tag_task transcript - one run publishes across two scopes on the bus`() =
        runTest {
            val transport =
                AgUiTransport { _: RunAgentInput ->
                    SseParser.parseTranscript(Fixtures.transcript("tag_task.sse")).asFlow() as Flow<AgUiEvent>
                }
            val session = ChatSession(transport)

            val taskScreen = mutableListOf<EntityChanged>()
            val tagScreen = mutableListOf<EntityChanged>()
            backgroundScope.launch { session.bus.forScopes(setOf("tasks")).collect { taskScreen += it } }
            backgroundScope.launch { session.bus.forScopes(setOf("tags")).collect { tagScreen += it } }
            yield()

            session.send("tag the vet task as urgent")
            yield()

            assertEquals(listOf(EntityChanged("Task", "task_0002", EntityChanged.Kind.UPDATED, "tasks")), taskScreen)
            assertEquals(listOf(EntityChanged("Tag", "tag_0001", EntityChanged.Kind.CREATED, "tags")), tagScreen)
            assertTrue(
                session.state.value.messages
                    .filterIsInstance<AssistantMessage>()
                    .any { it.content?.contains("(new tag)") == true },
            )
        }
}
