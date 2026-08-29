package com.mwe.chatcore

import kotlinx.serialization.Serializable

/** Payload of the AG-UI CUSTOM `entity_changed` event — see /contracts/entity-events.md. */
@Serializable
data class EntityChanged(
    val typename: String,
    val id: String,
    val kind: Kind,
    val scope: String,
) {
    @Serializable
    enum class Kind { CREATED, UPDATED, DELETED }
}

const val ENTITY_CHANGED_EVENT: String = "entity_changed"
