import Foundation

/// Read-side counterpart to ClickHouseSink, used only at boot to reload
/// perception state (regions). The Eye stays a writer at runtime; this
/// exists because the brain must never reset on restart.
enum ClickHouseQuery {
    static func rows(env: EnvFile, sql: String) async throws -> [[String: Any]] {
        let host = try env.require("CLICKHOUSE_HOST")
        let port = try env.require("CLICKHOUSE_PORT")
        var components = URLComponents(string: "https://\(host):\(port)/")!
        components.queryItems = [
            .init(name: "query", value: sql + " FORMAT JSONEachRow"),
        ]
        var request = URLRequest(url: components.url!)
        request.httpMethod = "POST"
        request.setValue(try env.require("CLICKHOUSE_USER"), forHTTPHeaderField: "X-ClickHouse-User")
        request.setValue(try env.require("CLICKHOUSE_PASSWORD"), forHTTPHeaderField: "X-ClickHouse-Key")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            let detail = String(data: data, encoding: .utf8) ?? "?"
            throw EyeError.modelIO("query failed: \(detail.prefix(200))")
        }
        guard let text = String(data: data, encoding: .utf8) else { return [] }
        return text.split(separator: "\n").compactMap { line in
            guard let lineData = line.data(using: .utf8) else { return nil }
            return try? JSONSerialization.jsonObject(with: lineData) as? [String: Any]
        }
    }
}
