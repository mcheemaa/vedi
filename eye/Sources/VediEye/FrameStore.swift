import Foundation

/// Ships keyframe originals to the Brain over localhost; the Brain is the
/// single Postgres writer. (Direct PostgresNIO was abandoned: BoringSSL
/// rejects the service CA's ECDSA signature that OpenSSL accepts, a
/// strict-DER divergence; the Brain's pg driver verifies it cleanly.)
actor FrameStore {
    private let endpoint: URL
    private var stored = 0
    private var failed = 0

    init(brainURL: String) throws {
        guard let url = URL(string: brainURL)?.appendingPathComponent("frames") else {
            throw EyeError.missingEnv("BRAIN_URL is not a parsable url")
        }
        endpoint = url
    }

    func store(frameID: UUID, ts: Date, camera: String, width: Int, height: Int, jpeg: Data) async {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.httpBody = jpeg
        request.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
        request.setValue(frameID.uuidString, forHTTPHeaderField: "x-frame-id")
        request.setValue(RowClock.formatter.string(from: ts), forHTTPHeaderField: "x-frame-ts")
        request.setValue(camera, forHTTPHeaderField: "x-frame-camera")
        request.setValue(String(width), forHTTPHeaderField: "x-frame-width")
        request.setValue(String(height), forHTTPHeaderField: "x-frame-height")
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                failed += 1
                Log.error("frame store: brain rejected: \((String(data: data, encoding: .utf8) ?? "?").prefix(120))")
                return
            }
            stored += 1
        } catch {
            failed += 1
            Log.error("frame store: transport error: \(error.localizedDescription)")
        }
    }

    func totalStored() -> Int { stored }

    /// Fire-and-forget stores race process exit; the caller knows how many
    /// it dispatched, so drain until they have all settled.
    func drain(expecting expected: Int) async {
        while stored + failed < expected {
            try? await Task.sleep(for: .milliseconds(50))
        }
    }
}
