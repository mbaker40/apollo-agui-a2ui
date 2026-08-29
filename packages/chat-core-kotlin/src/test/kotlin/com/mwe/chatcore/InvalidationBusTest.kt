package com.mwe.chatcore

import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.yield
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class InvalidationBusTest {
    @Test
    fun `screens receive only changes for their scopes`() =
        runTest {
            val bus = InvalidationBus()
            val taskScreen = mutableListOf<EntityChanged>()
            val settingsScreen = mutableListOf<EntityChanged>()

            val a = launch { bus.forScopes(setOf("tasks")).collect { taskScreen += it } }
            val b = launch { bus.forScopes(setOf("settings")).collect { settingsScreen += it } }
            yield()

            val taskChange = EntityChanged("Task", "task_0001", EntityChanged.Kind.CREATED, "tasks")
            val otherChange = EntityChanged("Setting", "s1", EntityChanged.Kind.UPDATED, "settings")
            bus.publish(taskChange)
            bus.publish(otherChange)
            yield()

            assertEquals(listOf(taskChange), taskScreen)
            assertEquals(listOf(otherChange), settingsScreen)
            a.cancel()
            b.cancel()
        }
}
