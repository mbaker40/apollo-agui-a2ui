// Version pins live in app/build.gradle.kts. This build cannot run in the
// authoring session (no Android SDK there) — see apps/android/README.md.
plugins {
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.2.20" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.2.20" apply false
    id("org.jetbrains.kotlin.plugin.serialization") version "2.2.20" apply false
    id("com.apollographql.apollo") version "4.3.1" apply false
}
