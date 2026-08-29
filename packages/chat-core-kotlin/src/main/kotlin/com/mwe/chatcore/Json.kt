package com.mwe.chatcore

import kotlinx.serialization.json.Json

/**
 * Wire-format configuration shared by the whole core:
 * - unknown keys/events from newer agents must not break parsing,
 * - defaults (role/type discriminators) must serialize,
 * - absent optionals are omitted rather than sent as null.
 */
val AgUiJson: Json =
    Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        explicitNulls = false
    }
