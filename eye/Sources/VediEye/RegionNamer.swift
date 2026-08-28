import Foundation

/// Turns a small-VLM caption into a region name. FastVLM-0.5B follows
/// instructions loosely and pads answers with narrator boilerplate, so
/// the prompt constrains hard and the cleaner strips what leaks through;
/// an unusable result returns nil so the engine retries on a later,
/// likely better, frame.
enum RegionNamer {
    static let prompt = "What is this? Answer with only a short name of two or three words."
    static let maxTokens = 12

    private static let boilerplate = [
        "the image provided is", "the image provided shows",
        "the image shows", "the image depicts", "the image is",
        "this image shows", "this image depicts", "this image is",
        "this is", "it is", "it shows", "a photo of", "an image of",
    ]

    static func clean(_ raw: String) -> String? {
        var text = raw
            .replacingOccurrences(of: "\n", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }

        var lowered = text.lowercased()
        var stripped = true
        while stripped {
            stripped = false
            for prefix in boilerplate where lowered.hasPrefix(prefix) {
                text = String(text.dropFirst(prefix.count))
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                lowered = text.lowercased()
                stripped = true
            }
        }

        var words = Array(text.split(separator: " ").prefix(4))
        // The word clamp can cut mid-phrase; a name never ends on glue.
        let glue: Set<String> = ["with", "of", "in", "on", "and", "a", "an", "the", "at", "to"]
        while let last = words.last, glue.contains(last.lowercased()) {
            words.removeLast()
        }
        guard !words.isEmpty else { return nil }
        var name = words.joined(separator: " ")
            .trimmingCharacters(in: .punctuationCharacters.union(.whitespacesAndNewlines))
        name = name.lowercased()

        // A name that is still describing rather than naming is a failed
        // naming, not a bad name; nil lets the engine try again.
        let degenerate = ["completely", "which", "that", "there", "unable", "sorry"]
        guard name.count >= 3, !degenerate.contains(where: { name.hasPrefix($0) }) else {
            return nil
        }
        return name
    }
}
