import Foundation

/// Fire-and-forget nudge to the Brain: the event rides inline so the
/// loop can think immediately, while ClickHouse remains the durable
/// record. A missed ring is tolerated by design; the Brain's heartbeat
/// reads the same tables and catches up.
final class Doorbell: Sendable {
    private let endpoint: URL
    private let session: URLSession

    init(brainURL: String) {
        endpoint = URL(string: "\(brainURL)/percepts") ?? URL(fileURLWithPath: "/dev/null")
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 0.5
        session = URLSession(configuration: config)
    }

    func ring(kind: String, detail: String, frameID: UUID, ts: Date) {
        let escaped = detail
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        let body = """
        {"ts":"\(RowClock.formatter.string(from: ts))","kind":"\(kind)","detail":"\(escaped)","frame_id":"\(frameID.uuidString)"}
        """
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.httpBody = body.data(using: .utf8)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        session.dataTask(with: request).resume()
    }
}
