import Foundation

struct PerceptEvent {
    let kind: String
    let detail: String
    let say: String
    let frameID: UUID
    let ts: Date

    func encoded(spoken: Bool) -> String {
        let escaped = detail
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        return """
        {"ts":"\(RowClock.formatter.string(from: ts))","kind":"\(kind)","detail":"\(escaped)","frame_id":"\(frameID.uuidString)","spoken":\(spoken ? 1 : 0)}
        """
    }
}

/// The reflex layer: deterministic rules over enrichment transitions.
/// Face detection jitters frame to frame, so a transition must hold for
/// K consecutive frames before it exists, and every rule carries a
/// cooldown on top; judgment about ambiguous moments belongs to the
/// future agent, not here. Confined to the enrich queue.
final class PerceptEvents: @unchecked Sendable {
    private var stableFaceCount: Int?
    private var candidateFaceCount: Int?
    private var candidateStreak = 0
    /// Frames a new face count must persist before it is believed.
    private let confirmFrames: Int
    private var lastFired: [String: Date] = [:]

    init(confirmFrames: Int = 3) {
        self.confirmFrames = confirmFrames
    }

    private func cooled(_ kind: String, _ ts: Date, seconds: TimeInterval) -> Bool {
        if let last = lastFired[kind], ts.timeIntervalSince(last) < seconds {
            return false
        }
        lastFired[kind] = ts
        return true
    }

    /// Debounced face count: nil until a change is confirmed.
    private func confirmedFaceCount(_ faces: Int) -> (from: Int, to: Int)? {
        guard let stable = stableFaceCount else {
            stableFaceCount = faces
            return nil
        }
        if faces == stable {
            candidateFaceCount = nil
            candidateStreak = 0
            return nil
        }
        if faces == candidateFaceCount {
            candidateStreak += 1
        } else {
            candidateFaceCount = faces
            candidateStreak = 1
        }
        guard candidateStreak >= confirmFrames else { return nil }
        stableFaceCount = faces
        candidateFaceCount = nil
        candidateStreak = 0
        return (from: stable, to: faces)
    }

    func assess(enrichment: Enrichment, sceneDelta: Float, frameID: UUID, ts: Date) -> [PerceptEvent] {
        var events: [PerceptEvent] = []

        if let change = confirmedFaceCount(enrichment.faceCount) {
            if change.to > change.from, cooled("person_entered", ts, seconds: 10) {
                let say = change.from == 0
                    ? "Hey, I see you."
                    : "Oh hey, I see someone just walked in."
                events.append(PerceptEvent(
                    kind: "person_entered",
                    detail: "faces \(change.from) -> \(change.to)",
                    say: say, frameID: frameID, ts: ts
                ))
            } else if change.to < change.from, cooled("person_left", ts, seconds: 10) {
                let say = change.to == 0
                    ? "Looks like everyone stepped out."
                    : "Looks like someone stepped out."
                events.append(PerceptEvent(
                    kind: "person_left",
                    detail: "faces \(change.from) -> \(change.to)",
                    say: say, frameID: frameID, ts: ts
                ))
            }
        }

        if enrichment.headForward > 0.45, cooled("posture", ts, seconds: 120) {
            events.append(PerceptEvent(
                kind: "posture",
                detail: String(format: "headForward %.2f", enrichment.headForward),
                say: "You're leaning in a lot. Sit back a little.",
                frameID: frameID, ts: ts
            ))
        }

        if sceneDelta > 0.5, cooled("scene_changed", ts, seconds: 30) {
            events.append(PerceptEvent(
                kind: "scene_changed",
                detail: String(format: "delta %.2f", sceneDelta),
                say: "",
                frameID: frameID, ts: ts
            ))
        }

        return events
    }
}
