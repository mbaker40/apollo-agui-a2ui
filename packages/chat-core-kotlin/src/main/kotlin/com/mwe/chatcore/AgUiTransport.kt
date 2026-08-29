package com.mwe.chatcore

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.serialization.encodeToString
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

/** Transport seam: production uses OkHttp; tests feed recorded transcripts. */
fun interface AgUiTransport {
    fun run(input: RunAgentInput): Flow<AgUiEvent>
}

class AgUiHttpException(
    val statusCode: Int,
    body: String,
) : RuntimeException("agent responded $statusCode: $body")

/**
 * POST RunAgentInput → SSE over OkHttp. Plain streamed-response parsing via
 * [SseParser] (no EventSource dependency) so the exact same parser is
 * exercised by transport, tests, and transcript replays.
 */
class OkHttpAgUiTransport(
    private val url: String,
    private val bearerToken: String? = null,
    client: OkHttpClient? = null,
) : AgUiTransport {
    private val client: OkHttpClient =
        client ?: OkHttpClient
            .Builder()
            .readTimeout(0, TimeUnit.MILLISECONDS) // SSE stream stays open
            .build()

    override fun run(input: RunAgentInput): Flow<AgUiEvent> =
        flow {
            val request =
                Request
                    .Builder()
                    .url(url)
                    .post(AgUiJson.encodeToString(input).toRequestBody(JSON_MEDIA_TYPE))
                    .header("accept", "text/event-stream")
                    .apply { bearerToken?.let { header("authorization", "Bearer $it") } }
                    .build()
            client.newCall(request).execute().use { response ->
                val body = response.body ?: throw AgUiHttpException(response.code, "<empty>")
                if (!response.isSuccessful) {
                    throw AgUiHttpException(response.code, body.string())
                }
                val parser = SseParser()
                val source = body.source()
                while (true) {
                    val line = source.readUtf8Line() ?: break
                    parser.feedLine(line)?.let { payload ->
                        emit(AgUiJson.decodeFromString(AgUiEventSerializer, payload))
                    }
                }
                parser.close()?.let { payload ->
                    emit(AgUiJson.decodeFromString(AgUiEventSerializer, payload))
                }
            }
        }.flowOn(Dispatchers.IO)

    private companion object {
        val JSON_MEDIA_TYPE = "application/json".toMediaType()
    }
}
