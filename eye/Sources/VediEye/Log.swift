import Foundation

/// Timestamped leveled logging to stdout: the live feed IS the log while
/// the Eye is a CLI. Rows in ClickHouse are the durable telemetry; this is
/// the operator's view. Grows an os.Logger backend when the Eye becomes an
/// app.
enum Log {
    private static let clock: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss.SSS"
        return formatter
    }()

    static func info(_ message: String) { emit("INFO", message) }
    static func warn(_ message: String) { emit("WARN", message) }
    static func error(_ message: String) { emit("ERROR", message) }

    private static func emit(_ level: String, _ message: String) {
        print("\(clock.string(from: Date())) \(level)  \(message)")
    }
}
