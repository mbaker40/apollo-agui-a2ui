/// Minimal incremental Server-Sent-Events parser: collects `data:` lines and
/// yields one payload per blank-line-terminated event. Comment lines and other
/// SSE fields are ignored (the agent only sends `data:`). Feed it arbitrary
/// chunks — payloads are emitted exactly at event boundaries regardless of how
/// the network fragments the stream. Mirrors chat-core-kotlin's SseParser.
public struct SseParser: Sendable {
    private var lineBuffer = ""
    private var dataLines: [String] = []

    public init() {}

    /// Feed a raw chunk; returns the payloads of any events completed by it.
    public mutating func feed(_ chunk: String) -> [String] {
        var completed: [String] = []
        for character in chunk {
            if character == "\n" {
                var line = lineBuffer
                lineBuffer = ""
                if line.hasSuffix("\r") { line.removeLast() }
                if let payload = feedLine(line) {
                    completed.append(payload)
                }
            } else {
                lineBuffer.append(character)
            }
        }
        return completed
    }

    /// Feed one line WITHOUT its terminator; returns a payload if it completed an event.
    public mutating func feedLine(_ line: String) -> String? {
        if line.isEmpty {
            guard !dataLines.isEmpty else { return nil }
            let payload = dataLines.joined(separator: "\n")
            dataLines.removeAll()
            return payload
        }
        if line.hasPrefix("data:") {
            var data = String(line.dropFirst("data:".count))
            if data.hasPrefix(" ") { data.removeFirst() }
            dataLines.append(data)
        }
        // Ignore `:` comments and other SSE fields (event:, id:, retry:).
        return nil
    }

    /// Flush a trailing event that was not blank-line terminated (stream end).
    public mutating func close() -> String? {
        lineBuffer = ""
        return feedLine("")
    }

    /// Parse a complete recorded transcript into events.
    public static func parseTranscript(_ transcript: String) throws -> [AgUiEvent] {
        var parser = SseParser()
        var payloads = parser.feed(transcript)
        if let trailing = parser.close() {
            payloads.append(trailing)
        }
        return try payloads.map { try AgUiEvent.decode(payload: $0) }
    }
}
