import Foundation

struct PipelineStats {
    private(set) var frames = 0
    private(set) var skipped = 0
    private(set) var keyframes = 0
    private var hashMs: [Double] = []
    private var embedMs: [Double] = []
    private var e2eMs: [Double] = []

    mutating func recordSkip(hashMs value: Double) {
        frames += 1
        skipped += 1
        hashMs.append(value)
    }

    mutating func recordKept(hashMs h: Double, embedMs e: Double, e2eMs total: Double) {
        frames += 1
        hashMs.append(h)
        embedMs.append(e)
        e2eMs.append(total)
    }

    mutating func markKeyframe() {
        keyframes += 1
    }

    func summary() -> String {
        func line(_ label: String, _ values: [Double]) -> String {
            guard !values.isEmpty else { return "  \(label): n/a" }
            let sorted = values.sorted()
            let p50 = sorted[sorted.count / 2]
            let p95 = sorted[min(sorted.count - 1, Int(Double(sorted.count) * 0.95))]
            return String(format: "  %@: p50 %.1fms  p95 %.1fms  n=%d", label, p50, p95, values.count)
        }
        return """
        frames seen: \(frames)  kept: \(frames - skipped)  skipped by pHash: \(skipped)  keyframes: \(keyframes)
        \(line("hash  ", hashMs))
        \(line("embed ", embedMs))
        \(line("e2e   ", e2eMs))
        """
    }
}
