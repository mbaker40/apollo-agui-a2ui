package com.mwe.chatcore

import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** The real OkHttp transport against a stubbed SSE HTTP server. */
class OkHttpTransportTest {
    private fun input() =
        RunAgentInput(
            threadId = "t",
            runId = "r",
            messages = listOf(UserMessage(id = "u1", content = "add a task to buy milk")),
        )

    @Test
    fun `streams and parses SSE from a POST response`() =
        runTest {
            MockWebServer().use { server ->
                server.enqueue(
                    MockResponse()
                        .setHeader("content-type", "text/event-stream")
                        .setBody(Fixtures.transcript("create_task.sse")),
                )
                val transport =
                    OkHttpAgUiTransport(server.url("/agui").toString(), bearerToken = "dev-token")
                val events = transport.run(input()).toList()

                assertEquals(12, events.size)
                assertEquals("RUN_STARTED", events.first().type)
                assertEquals("RUN_FINISHED", events.last().type)

                val request = server.takeRequest()
                assertEquals("POST", request.method)
                assertEquals("Bearer dev-token", request.getHeader("authorization"))
                val sent = AgUiJson.decodeFromString(RunAgentInput.serializer(), request.body.readUtf8())
                assertEquals("add a task to buy milk", (sent.messages.single() as UserMessage).content)
            }
        }

    @Test
    fun `non-2xx responses raise AgUiHttpException`() =
        runTest {
            MockWebServer().use { server ->
                server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":"nope"}"""))
                val transport = OkHttpAgUiTransport(server.url("/agui").toString())
                val error =
                    assertThrows(AgUiHttpException::class.java) {
                        kotlinx.coroutines.runBlocking { transport.run(input()).toList() }
                    }
                assertEquals(401, error.statusCode)
                assertTrue(error.message!!.contains("nope"))
            }
        }
}
