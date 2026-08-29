package com.mwe.chatcore

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import kotlin.random.Random

class SseParserTest {
    private val transcript = Fixtures.transcript("create_task.sse")

    @Test
    fun `whole-transcript and randomly-chunked parses agree`() {
        val whole = SseParser.parseTranscript(transcript)
        assertEquals(12, whole.size)

        val random = Random(42)
        repeat(20) {
            val parser = SseParser()
            val payloads = mutableListOf<String>()
            var index = 0
            while (index < transcript.length) {
                val end = minOf(transcript.length, index + 1 + random.nextInt(37))
                payloads += parser.feed(transcript.substring(index, end))
                index = end
            }
            parser.close()?.let(payloads::add)
            val chunked = payloads.map { AgUiJson.decodeFromString(AgUiEventSerializer, it) }
            assertEquals(whole, chunked)
        }
    }

    @Test
    fun `handles CRLF line endings and comment lines`() {
        val crlf =
            "': keepalive comment\r\ndata: {\"type\":\"RUN_STARTED\",\"threadId\":\"t\",\"runId\":\"r\"}\r\n\r\n'"
                .trim('\'')
        val events = SseParser.parseTranscript(crlf)
        assertEquals(listOf<AgUiEvent>(AgUiEvent.RunStarted(threadId = "t", runId = "r")), events)
    }

    @Test
    fun `flushes a trailing event with no final blank line`() {
        val parser = SseParser()
        val during = parser.feed("data: {\"type\":\"TEXT_MESSAGE_END\",\"messageId\":\"m\"}\n")
        assertEquals(emptyList<String>(), during)
        val trailing = parser.close()
        assertEquals("{\"type\":\"TEXT_MESSAGE_END\",\"messageId\":\"m\"}", trailing)
    }

    @Test
    fun `unknown event types parse as Unknown instead of crashing`() {
        val events = SseParser.parseTranscript("data: {\"type\":\"THINKING_START\",\"foo\":1}\n\n")
        assertEquals(listOf<AgUiEvent>(AgUiEvent.Unknown(type = "THINKING_START")), events)
    }
}
