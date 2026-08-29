package com.mwe.chatcore

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.yield
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** Replays the recorded transcripts through the session state machine + tool loop. */
class ChatSessionTest {
    private class ScriptedTransport(
        vararg transcripts: String,
    ) : AgUiTransport {
        val inputs = mutableListOf<RunAgentInput>()
        private val queue = ArrayDeque(transcripts.toList())

        override fun run(input: RunAgentInput): Flow<AgUiEvent> {
            inputs += input
            val transcript = queue.removeFirstOrNull() ?: ""
            return SseParser.parseTranscript(transcript).asFlow()
        }
    }

    private fun lastAssistantText(state: ChatState): String? =
        state.messages
            .filterIsInstance<AssistantMessage>()
            .lastOrNull { !it.content.isNullOrEmpty() }
            ?.content

    @Test
    fun `frontend tool loop - executes open_task locally and continues the run`() =
        runTest {
            val transport =
                ScriptedTransport(
                    Fixtures.transcript("open_task_deferred.sse"),
                    Fixtures.transcript("open_task_continuation.sse"),
                )
            val executed = mutableListOf<JsonObject>()
            val session =
                ChatSession(
                    transport = transport,
                    frontendTools =
                        FrontendToolRegistry(
                            listOf(
                                FrontendTool(StandardFrontendTools.OPEN_TASK) { args ->
                                    executed += args
                                    buildJsonObject {
                                        put("status", JsonPrimitive("opened"))
                                        put("id", args["id"] ?: JsonPrimitive(""))
                                    }
                                },
                            ),
                        ),
                )

            session.send("open the milk task")

            // The tool ran locally, once, with the streamed args.
            assertEquals(1, executed.size)
            assertEquals("task_0001", executed[0]["id"]?.jsonPrimitive?.content)

            // Two runs: deferred + continuation carrying the tool result and the capability.
            assertEquals(2, transport.inputs.size)
            val continuation = transport.inputs[1]
            assertEquals(listOf("open_task"), continuation.tools.map { it.name })
            assertTrue(
                continuation.messages.filterIsInstance<ToolMessage>().any {
                    it.content == """{"status":"opened","id":"task_0001"}"""
                },
            )

            val state = session.state.value
            assertEquals("Opened \"buy milk\" for you.", lastAssistantText(state))
            assertEquals(false, state.running)
            assertNull(state.error)
            assertTrue(session.pendingFrontendCalls().isEmpty())
        }

    @Test
    fun `backend write - publishes entity_changed on the invalidation bus`() =
        runTest {
            val session = ChatSession(ScriptedTransport(Fixtures.transcript("create_task.sse")))
            val received = mutableListOf<EntityChanged>()
            backgroundScope.launch {
                session.bus.forScopes(setOf("tasks")).collect { received += it }
            }
            yield()

            session.send("add a task to buy milk")
            yield()

            assertEquals(
                listOf(EntityChanged("Task", "task_0001", EntityChanged.Kind.CREATED, "tasks")),
                received,
            )
            assertEquals(
                "Created \"buy milk\" (task_0001). Anything else?",
                lastAssistantText(session.state.value),
            )
        }

    @Test
    fun `capability fallback - no tool call, streamed explanation`() =
        runTest {
            val session = ChatSession(ScriptedTransport(Fixtures.transcript("capability_fallback.sse")))
            session.send("open the milk task")

            assertEquals(
                1,
                session.state.value.messages
                    .filterIsInstance<UserMessage>()
                    .size,
            )
            assertTrue(session.pendingFrontendCalls().isEmpty())
            assertTrue(lastAssistantText(session.state.value)!!.contains("didn't advertise the open_task tool"))
        }

    @Test
    fun `run error - surfaces as error state, not a crash`() =
        runTest {
            val session = ChatSession(ScriptedTransport(Fixtures.transcript("run_error.sse")))
            session.send("add a task to call the vet")

            val state = session.state.value
            assertTrue(state.error!!.contains("executor unreachable"))
            assertEquals(false, state.running)
        }
}
