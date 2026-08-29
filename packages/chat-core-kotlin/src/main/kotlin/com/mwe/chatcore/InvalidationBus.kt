package com.mwe.chatcore

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.filter

/**
 * The mobile reconciliation seam (see /contracts/entity-events.md): chat
 * publishes every `entity_changed`; mounted screens subscribe filtered by the
 * scope(s) they render and refetch their own queries with a network-only
 * fetch policy, which rewrites the normalized Apollo cache and notifies
 * watchers.
 */
class InvalidationBus {
    private val _changes = MutableSharedFlow<EntityChanged>(extraBufferCapacity = 64)

    /** Every change, unfiltered (diagnostics, logging). */
    val changes: SharedFlow<EntityChanged> = _changes.asSharedFlow()

    fun publish(change: EntityChanged): Boolean = _changes.tryEmit(change)

    /** Changes relevant to a screen that renders the given scopes. */
    fun forScopes(scopes: Set<String>): Flow<EntityChanged> = changes.filter { it.scope in scopes }
}
