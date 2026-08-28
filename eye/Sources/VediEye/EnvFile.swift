import Foundation

struct EnvFile {
    let values: [String: String]
    let directory: URL

    subscript(key: String) -> String? { values[key] }

    func require(_ key: String) throws -> String {
        guard let value = values[key], !value.isEmpty else {
            throw EyeError.missingEnv(key)
        }
        return value
    }

    /// Walks upward from the working directory so the binary finds
    /// `vedi/.env.local` whether launched from `eye/` or the repo root.
    static func locate(named filename: String = ".env.local") throws -> EnvFile {
        var dir = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        for _ in 0..<6 {
            let candidate = dir.appendingPathComponent(filename)
            if FileManager.default.fileExists(atPath: candidate.path) {
                return try EnvFile(contentsOf: candidate)
            }
            dir.deleteLastPathComponent()
        }
        throw EyeError.missingEnv(filename)
    }

    init(contentsOf url: URL) throws {
        directory = url.deletingLastPathComponent()
        let text = try String(contentsOf: url, encoding: .utf8)
        var parsed: [String: String] = [:]
        for line in text.split(separator: "\n") {
            guard !line.hasPrefix("#"), let eq = line.firstIndex(of: "=") else { continue }
            let key = String(line[..<eq]).trimmingCharacters(in: .whitespaces)
            let value = String(line[line.index(after: eq)...]).trimmingCharacters(in: .whitespaces)
            parsed[key] = value
        }
        values = parsed
    }
}

enum EyeError: Error, CustomStringConvertible {
    case missingEnv(String)
    case noCamera(String)
    case modelIO(String)

    var description: String {
        switch self {
        case .missingEnv(let key): "missing environment value or file: \(key)"
        case .noCamera(let detail): "no usable camera: \(detail)"
        case .modelIO(let detail): "model I/O mismatch: \(detail)"
        }
    }
}
