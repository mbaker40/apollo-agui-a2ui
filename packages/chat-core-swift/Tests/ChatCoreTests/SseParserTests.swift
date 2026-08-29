import XCTest
@testable import ChatCore

final class SseParserTests: XCTestCase {
    func testWholeTranscriptAndRandomlyChunkedParsesAgree() throws {
        let transcript = try Fixtures.transcript("create_task.sse")
        let whole = try SseParser.parseTranscript(transcript)
        XCTAssertEqual(whole.count, 12)

        var generator = SeededGenerator(seed: 42)
        for _ in 0..<20 {
            var parser = SseParser()
            var payloads: [String] = []
            var index = transcript.startIndex
            while index < transcript.endIndex {
                let step = 1 + Int.random(in: 0..<37, using: &generator)
                let end = transcript.index(index, offsetBy: step, limitedBy: transcript.endIndex)
                    ?? transcript.endIndex
                payloads.append(contentsOf: parser.feed(String(transcript[index..<end])))
                index = end
            }
            if let trailing = parser.close() {
                payloads.append(trailing)
            }
            let chunked = try payloads.map { try AgUiEvent.decode(payload: $0) }
            XCTAssertEqual(whole, chunked)
        }
    }

    func testHandlesCRLFAndCommentLines() throws {
        let crlf = ": keepalive comment\r\ndata: {\"type\":\"RUN_STARTED\",\"threadId\":\"t\",\"runId\":\"r\"}\r\n\r\n"
        let events = try SseParser.parseTranscript(crlf)
        XCTAssertEqual(events, [.runStarted(threadId: "t", runId: "r")])
    }

    func testFlushesTrailingEventWithoutFinalBlankLine() throws {
        var parser = SseParser()
        let during = parser.feed("data: {\"type\":\"TEXT_MESSAGE_END\",\"messageId\":\"m\"}\n")
        XCTAssertEqual(during, [])
        XCTAssertEqual(parser.close(), "{\"type\":\"TEXT_MESSAGE_END\",\"messageId\":\"m\"}")
    }

    func testUnknownEventTypesParseAsUnknown() throws {
        let events = try SseParser.parseTranscript("data: {\"type\":\"THINKING_START\",\"foo\":1}\n\n")
        XCTAssertEqual(events, [.unknown(type: "THINKING_START")])
    }
}

/// Deterministic RNG so the chunk fuzzing reproduces across runs.
struct SeededGenerator: RandomNumberGenerator {
    private var state: UInt64
    init(seed: UInt64) { state = seed }
    mutating func next() -> UInt64 {
        state = state &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
        return state
    }
}
