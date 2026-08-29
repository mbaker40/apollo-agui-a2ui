package com.mwe.android

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.mwe.chatcore.AssistantMessage
import com.mwe.chatcore.Message
import com.mwe.chatcore.UserMessage

@Composable
fun AppScreen(viewModel: AppViewModel) {
    val chatState by viewModel.chatState.collectAsState()
    val tasks by viewModel.tasks.collectAsState()
    val selectedTaskId by viewModel.selectedTaskId.collectAsState()
    var draft by remember { mutableStateOf("") }

    Scaffold { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text("MWE Tasks", style = MaterialTheme.typography.titleMedium)

            // Task list: refreshed via bus-driven network-only refetch, no reload.
            LazyColumn(modifier = Modifier.weight(1f)) {
                items(tasks, key = { it.id }) { task ->
                    val highlight = task.id == selectedTaskId
                    Card(modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
                        Row(
                            modifier =
                                Modifier
                                    .fillMaxWidth()
                                    .background(if (highlight) Color(0x333556E0) else Color.Transparent)
                                    .padding(10.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Text(if (task.completed) "✓" else "○")
                            Text(task.title, modifier = Modifier.weight(1f))
                            Text(task.id, style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }
            }

            // Chat transcript (assistant text + tool-call chips as plain rows).
            LazyColumn(modifier = Modifier.weight(1f)) {
                items(chatState.messages, key = { it.id }) { message -> MessageRow(message) }
                if (chatState.error != null) {
                    item { Text("Run failed: ${chatState.error}", color = Color(0xFFC0392B)) }
                }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = draft,
                    onValueChange = { draft = it },
                    modifier = Modifier.weight(1f),
                    placeholder = { Text("add a task to buy milk") },
                    enabled = !chatState.running,
                )
                Button(
                    onClick = {
                        viewModel.send(draft)
                        draft = ""
                    },
                    enabled = !chatState.running && draft.isNotBlank(),
                ) {
                    Text(if (chatState.running) "…" else "Send")
                }
            }
        }
    }
}

@Composable
private fun MessageRow(message: Message) {
    when (message) {
        is UserMessage -> Text("You: ${message.content}", modifier = Modifier.padding(vertical = 2.dp))
        is AssistantMessage -> {
            message.toolCalls?.forEach { call ->
                Text(
                    "⚙ ${call.function.name}(${call.function.arguments})",
                    style = MaterialTheme.typography.labelSmall,
                    modifier = Modifier.padding(vertical = 1.dp),
                )
            }
            if (!message.content.isNullOrEmpty()) {
                Text("Agent: ${message.content}", modifier = Modifier.padding(vertical = 2.dp))
            }
        }
        else -> Unit
    }
}
