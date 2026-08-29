package com.mwe.chatcore

/**
 * Minimal incremental Server-Sent-Events parser: collects `data:` lines and
 * yields one payload per blank-line-terminated event. Comment lines and other
 * SSE fields are ignored (the agent only sends `data:`). Feed it arbitrary
 * chunks — payloads are emitted exactly at event boundaries regardless of how
 * the network fragments the stream.
 */
class SseParser {
    private val lineBuffer = StringBuilder()
    private val dataLines = mutableListOf<String>()

    /** Feed a raw chunk; returns the payloads of any events completed by it. */
    fun feed(chunk: String): List<String> {
        val completed = mutableListOf<String>()
        for (ch in chunk) {
            when (ch) {
                '\n' -> {
                    val line = lineBuffer.toString().removeSuffix("\r")
                    lineBuffer.setLength(0)
                    feedLine(line)?.let(completed::add)
                }
                else -> lineBuffer.append(ch)
            }
        }
        return completed
    }

    /** Feed one line WITHOUT its terminator; returns a payload if it completed an event. */
    fun feedLine(line: String): String? {
        if (line.isEmpty()) {
            if (dataLines.isEmpty()) return null
            val payload = dataLines.joinToString("\n")
            dataLines.clear()
            return payload
        }
        if (line.startsWith("data:")) {
            dataLines.add(line.removePrefix("data:").removePrefix(" "))
        }
        // Ignore `:` comments and other SSE fields (event:, id:, retry:).
        return null
    }

    /** Flush a trailing event that was not blank-line terminated (stream end). */
    fun close(): String? = feedLine("").also { lineBuffer.setLength(0) }

    fun parseEvents(chunk: String): List<AgUiEvent> = feed(chunk).map { AgUiJson.decodeFromString(AgUiEventSerializer, it) }

    companion object {
        /** Parse a complete recorded transcript into events. */
        fun parseTranscript(transcript: String): List<AgUiEvent> {
            val parser = SseParser()
            val payloads = parser.feed(transcript).toMutableList()
            parser.close()?.let(payloads::add)
            return payloads.map { AgUiJson.decodeFromString(AgUiEventSerializer, it) }
        }
    }
}
