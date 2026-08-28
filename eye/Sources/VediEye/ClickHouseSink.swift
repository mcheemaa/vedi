import Foundation

/// One sink per table. Buffers encoded JSONEachRow lines and ships them
/// over HTTPS with server-side async inserts, keeping the capture path
/// from ever waiting on the network.
actor ClickHouseSink {
    private let endpoint: URL
    private let headers: [String: String]
    private var buffer: [String] = []
    private var shipped = 0
    private let flushEvery: Int

    /// waitForAck trades ~200ms per flush for SELECT-visible-on-ack:
    /// right for the low-volume tables the Brain queries mid-conversation
    /// (events, enrichments, regions); percepts stay fire-and-forget for
    /// raw ingest throughput.
    init(env: EnvFile, table: String, flushEvery: Int = 10, waitForAck: Bool = false) throws {
        let host = try env.require("CLICKHOUSE_HOST")
        let port = try env.require("CLICKHOUSE_PORT")
        var components = URLComponents(string: "https://\(host):\(port)/")!
        components.queryItems = [
            .init(name: "query", value: "INSERT INTO \(table) FORMAT JSONEachRow"),
            .init(name: "async_insert", value: "1"),
            .init(name: "wait_for_async_insert", value: waitForAck ? "1" : "0"),
        ]
        endpoint = components.url!
        headers = [
            "X-ClickHouse-User": try env.require("CLICKHOUSE_USER"),
            "X-ClickHouse-Key": try env.require("CLICKHOUSE_PASSWORD"),
            "Content-Type": "application/x-ndjson",
        ]
        self.flushEvery = flushEvery
    }

    func add(_ encodedLine: String) async {
        buffer.append(encodedLine)
        if buffer.count >= flushEvery {
            await flush()
        }
    }

    func flush() async {
        guard !buffer.isEmpty else { return }
        let body = buffer.joined(separator: "\n").data(using: .utf8)!
        let count = buffer.count
        buffer.removeAll(keepingCapacity: true)

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.httpBody = body
        for (key, value) in headers {
            request.setValue(value, forHTTPHeaderField: key)
        }
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                let detail = String(data: data, encoding: .utf8) ?? "?"
                Log.error("sink: insert failed: \(detail.prefix(200))")
                return
            }
            shipped += count
        } catch {
            Log.error("sink: transport error: \(error)")
        }
    }

    func totalShipped() -> Int { shipped }
}
