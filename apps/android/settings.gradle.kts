pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "mwe-android"

// Composite build: the app depends on com.mwe:chat-core-kotlin and Gradle
// substitutes the local project — no publishing step needed.
includeBuild("../../packages/chat-core-kotlin")

include(":app")
