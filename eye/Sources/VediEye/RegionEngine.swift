import Foundation
import os

/// The growing brain: online leader clustering over frame embeddings.
/// Regions are born from experience (nothing is shipped preconfigured),
/// light up on recurrence before they have names, and earn a name from
/// the captioner once mature. State is lock-confined because assignment
/// runs synchronously on the capture path while naming lands from the
/// enrich queue; @unchecked Sendable states that discipline.
final class RegionEngine: @unchecked Sendable {
    struct Region: Sendable {
        var id: UInt32
        var centroid: [Float]
        var count: UInt64
        var firstSeen: Date
        var lastSeen: Date
        var exemplarFrameID: UUID
        var exemplarSim: Float
        var label: String
        var status: String
        var namingRequested: Bool
        var dirty: Bool
    }

    struct Assignment {
        let regionID: UInt32
        let sim: Float
        let born: Bool
        /// True exactly once, when the region crosses maturity unnamed:
        /// the caller owns triggering the naming caption.
        let needsNaming: Bool
    }

    private struct State {
        var regions: [Region] = []
        var nextID: UInt32 = 1
        var assignments: Int = 0
    }

    /// Cosine floor to join an existing region; below it a region is born.
    /// Calibration target for the replay harness.
    private let tauAssign: Float
    /// Centroid drift rate per assignment.
    private let alpha: Float = 0.05
    /// Centroids closer than this merge into one region.
    private let tauMerge: Float = 0.92
    private let maturityCount: UInt64 = 10
    private let maturityAge: TimeInterval = 60
    private let mergeEvery = 500

    private let state = OSAllocatedUnfairLock(initialState: State())

    init(tauAssign: Float = 0.80) {
        self.tauAssign = tauAssign
    }

    func assign(_ embedding: [Float], frameID: UUID, ts: Date) -> Assignment? {
        guard let unit = Self.normalized(embedding) else { return nil }
        return state.withLock { s in
            s.assignments += 1
            if s.assignments % mergeEvery == 0 {
                mergeConverged(&s)
            }

            var bestIndex = -1
            var bestSim: Float = -1
            for (i, region) in s.regions.enumerated() {
                let sim = Self.dot(region.centroid, unit)
                if sim > bestSim {
                    bestSim = sim
                    bestIndex = i
                }
            }

            if bestIndex >= 0, bestSim >= tauAssign {
                var region = s.regions[bestIndex]
                region.count += 1
                region.lastSeen = ts
                var blended = [Float](repeating: 0, count: unit.count)
                for i in 0..<unit.count {
                    blended[i] = region.centroid[i] * (1 - alpha) + unit[i] * alpha
                }
                region.centroid = Self.normalized(blended) ?? region.centroid
                if bestSim > region.exemplarSim {
                    region.exemplarSim = bestSim
                    region.exemplarFrameID = frameID
                }
                var needsNaming = false
                if !region.namingRequested,
                   region.label.isEmpty,
                   region.count >= maturityCount,
                   ts.timeIntervalSince(region.firstSeen) >= maturityAge {
                    region.namingRequested = true
                    needsNaming = true
                }
                region.dirty = true
                s.regions[bestIndex] = region
                return Assignment(regionID: region.id, sim: bestSim, born: false, needsNaming: needsNaming)
            }

            let region = Region(
                id: s.nextID, centroid: unit, count: 1,
                firstSeen: ts, lastSeen: ts,
                exemplarFrameID: frameID, exemplarSim: 1,
                label: "", status: "young",
                namingRequested: false, dirty: true
            )
            s.nextID += 1
            s.regions.append(region)
            return Assignment(regionID: region.id, sim: bestSim, born: true, needsNaming: false)
        }
    }

    func setLabel(_ regionID: UInt32, label: String) {
        state.withLock { s in
            guard let i = s.regions.firstIndex(where: { $0.id == regionID }) else { return }
            s.regions[i].label = label
            s.regions[i].status = "mature"
            s.regions[i].dirty = true
        }
    }

    /// A naming attempt produced nothing usable; allow a later
    /// assignment to trigger naming again on a fresher frame.
    func retryNaming(_ regionID: UInt32) {
        state.withLock { s in
            guard let i = s.regions.firstIndex(where: { $0.id == regionID }) else { return }
            s.regions[i].namingRequested = false
        }
    }

    /// Rows changed since the last call; the caller ships them.
    func dirtyRows() -> [RegionRow] {
        state.withLock { s in
            var rows: [RegionRow] = []
            for i in s.regions.indices where s.regions[i].dirty {
                s.regions[i].dirty = false
                rows.append(RegionRow(region: s.regions[i], updatedAt: Date()))
            }
            return rows
        }
    }

    func count() -> Int {
        state.withLock { $0.regions.count }
    }

    /// Reload persisted regions at boot; the brain never resets.
    /// Rows are parsed before the lock because [[String: Any]] is not
    /// Sendable and must not cross into the locked closure.
    func load(_ rows: [[String: Any]]) {
        var parsed: [Region] = []
        var maxID: UInt32 = 0
        for row in rows {
            guard let id = (row["region_id"] as? NSNumber)?.uint32Value,
                  let rawCentroid = row["centroid"] as? [Any]
            else { continue }
            let centroid = rawCentroid.compactMap { ($0 as? NSNumber)?.floatValue }
            guard let unit = Self.normalized(centroid) else { continue }
            let firstSeen = (row["first_seen"] as? String)
                .flatMap { RowClock.formatter.date(from: $0) } ?? Date()
            let lastSeen = (row["last_seen"] as? String)
                .flatMap { RowClock.formatter.date(from: $0) } ?? firstSeen
            let label = row["label"] as? String ?? ""
            parsed.append(Region(
                id: id, centroid: unit,
                count: (row["member_count"] as? NSNumber)?.uint64Value ?? 1,
                firstSeen: firstSeen, lastSeen: lastSeen,
                exemplarFrameID: (row["exemplar_frame_id"] as? String)
                    .flatMap { UUID(uuidString: $0) } ?? UUID(),
                exemplarSim: 1,
                label: label,
                status: row["status"] as? String ?? (label.isEmpty ? "young" : "mature"),
                namingRequested: !label.isEmpty,
                dirty: false
            ))
            maxID = max(maxID, id)
        }
        let regions = parsed
        let nextID = maxID + 1
        state.withLock { s in
            s.regions.append(contentsOf: regions)
            s.nextID = max(s.nextID, nextID)
        }
    }

    /// Fold regions whose centroids converged; keeps the older id so
    /// stored percepts stay meaningful for the survivor.
    private func mergeConverged(_ s: inout State) {
        var i = 0
        while i < s.regions.count {
            var j = i + 1
            while j < s.regions.count {
                if Self.dot(s.regions[i].centroid, s.regions[j].centroid) >= tauMerge {
                    let a = s.regions[i]
                    let b = s.regions[j]
                    let total = Float(a.count + b.count)
                    var blended = [Float](repeating: 0, count: a.centroid.count)
                    for k in 0..<a.centroid.count {
                        blended[k] = (a.centroid[k] * Float(a.count) + b.centroid[k] * Float(b.count)) / total
                    }
                    var merged = a.id <= b.id ? a : b
                    let absorbed = a.id <= b.id ? b : a
                    merged.centroid = Self.normalized(blended) ?? merged.centroid
                    merged.count = a.count + b.count
                    merged.firstSeen = min(a.firstSeen, b.firstSeen)
                    merged.lastSeen = max(a.lastSeen, b.lastSeen)
                    if merged.label.isEmpty, !absorbed.label.isEmpty {
                        merged.label = absorbed.label
                        merged.status = "mature"
                    }
                    merged.dirty = true
                    s.regions[i] = merged
                    s.regions.remove(at: j)
                    Log.info("regions: \(absorbed.id) merged into \(merged.id)")
                } else {
                    j += 1
                }
            }
            i += 1
        }
    }

    private static func dot(_ a: [Float], _ b: [Float]) -> Float {
        var sum: Float = 0
        for i in 0..<min(a.count, b.count) { sum += a[i] * b[i] }
        return sum
    }

    private static func normalized(_ v: [Float]) -> [Float]? {
        var normSq: Float = 0
        for x in v { normSq += x * x }
        let norm = normSq.squareRoot()
        guard norm > 1e-10 else { return nil }
        return v.map { $0 / norm }
    }
}
