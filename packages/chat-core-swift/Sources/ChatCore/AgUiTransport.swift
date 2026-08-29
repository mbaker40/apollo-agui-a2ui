import Foundation
#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif

/// Transport seam: production uses URLSession; tests feed recorded transcripts.
public protocol AgUiTransport: Sendable {
    func run(_ input: RunAgentInput) -> AsyncThrowingStream<AgUiEvent, Error>
}

public struct AgUiHttpError: Error, CustomStringConvertible {
    public let statusCode: Int
    public let body: String
    public var description: String { "agent responded \(statusCode): \(body)" }
}

/// POST RunAgentInput → SSE via URLSession, bridged through a data-task
/// delegate so the same code path works on iOS AND Linux (corelibs-foundation
/// has no `URLSession.bytes`). Chunks stream through [SseParser], the exact
/// parser the tests fuzz with recorded transcripts.
public struct URLSessionAgUiTransport: AgUiTransport {
    private let url: URL
    private let bearerToken: String?

    public init(url: URL, bearerToken: String? = nil) {
        self.url = url
        self.bearerToken = bearerToken
    }

    public func run(_ input: RunAgentInput) -> AsyncThrowingStream<AgUiEvent, Error> {
        AsyncThrowingStream { continuation in
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "content-type")
            request.setValue("text/event-stream", forHTTPHeaderField: "accept")
            if let bearerToken {
                request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "authorization")
            }
            do {
                request.httpBody = try JSONEncoder().encode(input)
            } catch {
                continuation.finish(throwing: error)
                return
            }

            // One short-lived session per run; the delegate invalidates it on
            // completion (avoids capturing URLSession in a @Sendable closure —
            // it is not Sendable on Linux corelibs-foundation).
            let delegate = StreamingDelegate(continuation: continuation)
            let session = URLSession(
                configuration: .default, delegate: delegate, delegateQueue: nil
            )
            session.dataTask(with: request).resume()
        }
    }

    private final class StreamingDelegate: NSObject, URLSessionDataDelegate, @unchecked Sendable {
        private let continuation: AsyncThrowingStream<AgUiEvent, Error>.Continuation
        private var parser = SseParser()
        private var statusCode = 200
        private var errorBody = Data()

        init(continuation: AsyncThrowingStream<AgUiEvent, Error>.Continuation) {
            self.continuation = continuation
        }

        func urlSession(
            _ session: URLSession,
            dataTask: URLSessionDataTask,
            didReceive response: URLResponse,
            completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
        ) {
            statusCode = (response as? HTTPURLResponse)?.statusCode ?? 200
            completionHandler(.allow)
        }

        func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
            guard statusCode < 400 else {
                errorBody.append(data)
                return
            }
            for payload in parser.feed(String(decoding: data, as: UTF8.self)) {
                yield(payload)
            }
        }

        func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
            if statusCode >= 400 {
                continuation.finish(
                    throwing: AgUiHttpError(
                        statusCode: statusCode,
                        body: String(decoding: errorBody, as: UTF8.self)
                    )
                )
            } else if let error {
                continuation.finish(throwing: error)
            } else {
                if let trailing = parser.close() {
                    yield(trailing)
                }
                continuation.finish()
            }
            session.finishTasksAndInvalidate()
        }

        private func yield(_ payload: String) {
            do {
                continuation.yield(try AgUiEvent.decode(payload: payload))
            } catch {
                continuation.finish(throwing: error)
            }
        }
    }
}
