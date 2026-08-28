import Foundation

/// CLIP BPE tokenizer loaded from clip_tokenizer.json (open_clip
/// SimpleTokenizer vocabulary for mobileclip-s2). Ported from Shadow,
/// where it is parity-verified against open_clip on a fixed prompt set;
/// the BPE core is kept verbatim so that verification carries over.
final class ClipTextTokenizer: Sendable {
    let contextLength: Int
    let sotToken: Int32
    let eotToken: Int32
    let modelID: String

    private let encoder: [String: Int32]
    private let byteEncoder: [UInt8: Character]
    private let bpeRanks: [String: Int]

    /// open_clip's pre-tokenization pattern: contractions, letter runs,
    /// single digits, punctuation clusters.
    private static let wordPattern: NSRegularExpression = {
        let pattern = #"'s|'t|'re|'ve|'m|'ll|'d|[a-zA-Z]+|[0-9]|[^\sa-zA-Z0-9]+"#
        // The pattern is a compile-time constant; a failure here is a
        // programmer error, not a runtime condition.
        return try! NSRegularExpression(pattern: pattern)
    }()

    init(url: URL) throws {
        let data = try Data(contentsOf: url)
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let modelID = json["model_id"] as? String,
              let contextLength = json["context_length"] as? Int,
              let sotToken = json["sot_token"] as? Int,
              let eotToken = json["eot_token"] as? Int,
              let encoderDict = json["encoder"] as? [String: Int],
              let byteEncoderDict = json["byte_encoder"] as? [String: String],
              let mergesArray = json["merges"] as? [String]
        else {
            throw EyeError.modelIO("clip_tokenizer.json missing required fields")
        }

        self.modelID = modelID
        self.contextLength = contextLength
        self.sotToken = Int32(sotToken)
        self.eotToken = Int32(eotToken)

        var enc: [String: Int32] = [:]
        enc.reserveCapacity(encoderDict.count)
        for (k, v) in encoderDict { enc[k] = Int32(v) }
        self.encoder = enc

        var bytes: [UInt8: Character] = [:]
        for (k, v) in byteEncoderDict {
            if let byte = UInt8(k), let char = v.first { bytes[byte] = char }
        }
        self.byteEncoder = bytes

        var ranks: [String: Int] = [:]
        ranks.reserveCapacity(mergesArray.count)
        for (i, merge) in mergesArray.enumerated() { ranks[merge] = i }
        self.bpeRanks = ranks
    }

    /// Tokenize into [SOT, tokens..., EOT, 0, ...] padded to contextLength.
    func tokenize(_ text: String) -> [Int32] {
        let cleaned = text.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        var tokens: [Int32] = [sotToken]

        for word in split(cleaned) {
            let encoded = byteEncode(word)
            guard !encoded.isEmpty else { continue }
            for token in bpe(encoded) {
                if let id = encoder[token] { tokens.append(id) }
            }
            if tokens.count >= contextLength - 1 { break }
        }

        if tokens.count > contextLength - 1 {
            tokens = Array(tokens.prefix(contextLength - 1))
        }
        tokens.append(eotToken)
        while tokens.count < contextLength { tokens.append(0) }
        return tokens
    }

    private func split(_ text: String) -> [String] {
        let range = NSRange(text.startIndex..., in: text)
        return Self.wordPattern.matches(in: text, range: range).compactMap { match in
            Range(match.range, in: text).map { String(text[$0]) }
        }
    }

    private func byteEncode(_ word: String) -> String {
        String(Array(word.utf8).compactMap { byteEncoder[$0] })
    }

    private func bpe(_ token: String) -> [String] {
        if token.isEmpty { return [] }
        var word = Array(token).map { String($0) }
        if word.count <= 1 { return [word[0] + "</w>"] }
        word[word.count - 1] += "</w>"

        while word.count > 1 {
            var bestRank = Int.max
            var bestIndex = -1
            for i in 0..<(word.count - 1) {
                if let rank = bpeRanks["\(word[i]) \(word[i + 1])"], rank < bestRank {
                    bestRank = rank
                    bestIndex = i
                }
            }
            guard bestIndex >= 0 else { break }

            let first = word[bestIndex]
            let second = word[bestIndex + 1]
            let merged = first + second
            var next: [String] = []
            var i = 0
            while i < word.count {
                if i < word.count - 1, word[i] == first, word[i + 1] == second {
                    next.append(merged)
                    i += 2
                } else {
                    next.append(word[i])
                    i += 1
                }
            }
            word = next
        }
        return word
    }
}
