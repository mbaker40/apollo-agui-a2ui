package com.mwe.chatcore

import java.nio.file.Files
import java.nio.file.Path

/** Shared cross-platform fixtures; the Gradle test working dir is the project dir. */
object Fixtures {
    private val root: Path = Path.of("..", "..", "contracts", "fixtures")

    fun transcript(name: String): String = Files.readString(root.resolve("transcripts").resolve(name))

    fun json(relative: String): String = Files.readString(root.resolve(relative))
}
