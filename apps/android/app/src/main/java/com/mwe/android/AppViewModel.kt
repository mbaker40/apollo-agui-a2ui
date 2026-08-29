package com.mwe.android

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.apollographql.apollo.ApolloClient
import com.apollographql.apollo.cache.normalized.FetchPolicy
import com.apollographql.apollo.cache.normalized.api.MemoryCacheFactory
import com.apollographql.apollo.cache.normalized.fetchPolicy
import com.apollographql.apollo.cache.normalized.normalizedCache
import com.apollographql.apollo.cache.normalized.watch
import com.mwe.android.graphql.TasksQuery
import com.mwe.chatcore.ChatSession
import com.mwe.chatcore.ChatState
import com.mwe.chatcore.FrontendTool
import com.mwe.chatcore.FrontendToolRegistry
import com.mwe.chatcore.OkHttpAgUiTransport
import com.mwe.chatcore.StandardFrontendTools
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * The thin shell: Apollo Kotlin wiring + a screen ViewModel. Everything
 * protocol-shaped (SSE, events, tool loop, bus) lives in chat-core-kotlin,
 * which is what the JVM test suite covers in-session.
 */
class AppViewModel : ViewModel() {
    private val apollo: ApolloClient =
        ApolloClient.Builder()
            .serverUrl(Config.GRAPHQL_URL)
            .addHttpHeader("authorization", "Bearer ${Config.DEV_JWT}")
            .normalizedCache(MemoryCacheFactory(maxSizeBytes = 10 * 1024 * 1024))
            .build()

    private val selectedTaskIdFlow = MutableStateFlow<String?>(null)
    val selectedTaskId: StateFlow<String?> = selectedTaskIdFlow.asStateFlow()

    private val tasksFlow = MutableStateFlow<List<TasksQuery.Task>>(emptyList())
    val tasks: StateFlow<List<TasksQuery.Task>> = tasksFlow.asStateFlow()

    val session: ChatSession =
        ChatSession(
            transport = OkHttpAgUiTransport(Config.AGENT_URL, bearerToken = Config.DEV_JWT),
            frontendTools =
                FrontendToolRegistry(
                    listOf(
                        FrontendTool(StandardFrontendTools.OPEN_TASK) { args -> openTask(args) },
                    ),
                ),
        )

    val chatState: StateFlow<ChatState> get() = session.state

    init {
        // Watch the normalized cache: any cache rewrite re-emits the query.
        viewModelScope.launch {
            apollo.query(TasksQuery()).watch().collect { response ->
                response.data?.tasks?.let { tasksFlow.value = it }
            }
        }
        // THE reconciliation seam (contracts/entity-events.md): chat publishes
        // entity_changed → this screen refetches ITS OWN query network-only,
        // which rewrites the cache and notifies the watcher above.
        viewModelScope.launch {
            session.bus.forScopes(setOf("tasks")).collect {
                apollo.query(TasksQuery()).fetchPolicy(FetchPolicy.NetworkOnly).execute()
            }
        }
    }

    fun send(text: String) {
        viewModelScope.launch { session.send(text) }
    }

    private fun openTask(args: JsonObject): JsonObject {
        val id = args["id"]?.jsonPrimitive?.content.orEmpty()
        val exists = tasksFlow.value.any { it.id == id }
        if (exists) selectedTaskIdFlow.value = id
        return buildJsonObject {
            put("status", JsonPrimitive(if (exists) "opened" else "not_found"))
            put("id", JsonPrimitive(id))
        }
    }

    override fun onCleared() {
        apollo.close()
        super.onCleared()
    }
}
