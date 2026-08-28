import Foundation

/// Vedi's interim mouth: the macOS `say` command on a serial queue, so
/// utterances never overlap and never block perception. The real voice
/// loop (streaming TTS) replaces this behind the same speak() seam.
final class Voice: @unchecked Sendable {
    private let queue = DispatchQueue(label: "wiki.vedi.eye.voice")
    private let voiceName: String?
    private let enabled: Bool

    init(enabled: Bool, voiceName: String? = nil) {
        self.enabled = enabled
        self.voiceName = voiceName
    }

    func speak(_ text: String) {
        guard enabled, !text.isEmpty else { return }
        queue.async { [voiceName] in
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/say")
            var arguments: [String] = []
            if let voiceName {
                arguments += ["-v", voiceName]
            }
            arguments.append(text)
            process.arguments = arguments
            do {
                try process.run()
                process.waitUntilExit()
            } catch {
                Log.error("voice: \(error.localizedDescription)")
            }
        }
    }
}
