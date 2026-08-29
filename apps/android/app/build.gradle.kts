plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("com.apollographql.apollo")
}

android {
    namespace = "com.mwe.android"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.mwe.android"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
    }
}

apollo {
    service("mwe") {
        packageName.set("com.mwe.android.graphql")
        // Canonical SDL, generated from the facade and pinned by
        // services/graphql/test/schema-file.test.ts.
        schemaFiles.from(file("../../../services/graphql/schema.graphqls"))
    }
}

dependencies {
    // All chat/AG-UI/invalidation logic lives in the JVM core (tested in-session).
    implementation("com.mwe:chat-core-kotlin:0.1.0")

    implementation("com.apollographql.apollo:apollo-runtime:4.3.1")
    implementation("com.apollographql.apollo:apollo-normalized-cache:4.3.1")

    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
}
