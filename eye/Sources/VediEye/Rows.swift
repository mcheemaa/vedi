import Foundation

enum RowClock {
    static let formatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS"
        formatter.timeZone = TimeZone(identifier: "UTC")
        return formatter
    }()
}

struct PerceptRow: Sendable {
    let ts: Date
    let frameID: UUID
    let camera: String
    let eyeSession: UUID
    let phash: UInt64
    let hashMs: Double
    let embedMs: Double
    let e2eMs: Double
    let sceneDelta: Float
    let keyframe: Bool
    let sceneID: UInt32
    let regionID: UInt32
    let regionSim: Float
    let embedding: [Float]

    func encoded() -> String {
        let vector = embedding.map { String(format: "%.6f", $0) }.joined(separator: ",")
        return """
        {"ts":"\(RowClock.formatter.string(from: ts))","frame_id":"\(frameID.uuidString)","camera":"\(camera)","eye_session":"\(eyeSession.uuidString)","phash":\(phash),"hash_ms":\(String(format: "%.2f", hashMs)),"embed_ms":\(String(format: "%.2f", embedMs)),"e2e_ms":\(String(format: "%.2f", e2eMs)),"scene_delta":\(String(format: "%.4f", sceneDelta)),"keyframe":\(keyframe ? 1 : 0),"scene_id":\(sceneID),"region_id":\(regionID),"region_sim":\(String(format: "%.4f", regionSim)),"embedding":[\(vector)]}
        """
    }
}

struct RegionRow: Sendable {
    let regionID: UInt32
    let centroid: [Float]
    let memberCount: UInt64
    let firstSeen: Date
    let lastSeen: Date
    let exemplarFrameID: UUID
    let label: String
    let status: String
    let updatedAt: Date

    init(region: RegionEngine.Region, updatedAt: Date) {
        regionID = region.id
        centroid = region.centroid
        memberCount = region.count
        firstSeen = region.firstSeen
        lastSeen = region.lastSeen
        exemplarFrameID = region.exemplarFrameID
        label = region.label
        status = region.status
        self.updatedAt = updatedAt
    }

    func encoded() -> String {
        let vector = centroid.map { String(format: "%.6f", $0) }.joined(separator: ",")
        let escaped = label
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        return """
        {"region_id":\(regionID),"centroid":[\(vector)],"member_count":\(memberCount),"first_seen":"\(RowClock.formatter.string(from: firstSeen))","last_seen":"\(RowClock.formatter.string(from: lastSeen))","exemplar_frame_id":"\(exemplarFrameID.uuidString)","label":"\(escaped)","status":"\(status)","updated_at":"\(RowClock.formatter.string(from: updatedAt))"}
        """
    }
}

/// Run lifecycle markers written into vedi.events so the memory records
/// when the Eye was open and when it went dark; the agent reads its own
/// blind spots from these.
struct LifecycleEvent: Sendable {
    let kind: String
    let detail: String
    let ts: Date

    func encoded() -> String {
        let escaped = detail
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        return """
        {"ts":"\(RowClock.formatter.string(from: ts))","kind":"\(kind)","detail":"\(escaped)","frame_id":"00000000-0000-0000-0000-000000000000","spoken":0}
        """
    }
}

struct EnrichmentRow: Sendable {
    let frameID: UUID
    let ts: Date
    let enrichment: Enrichment
    let caption: String
    let captionMs: Double

    func encoded() -> String {
        let escapedCaption = caption
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: " ")
        let escapedText = enrichment.ocrText
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: " ")
        return """
        {"frame_id":"\(frameID.uuidString)","ts":"\(RowClock.formatter.string(from: ts))","ocr_text":"\(escapedText)","face_count":\(enrichment.faceCount),"head_forward":\(String(format: "%.3f", enrichment.headForward)),"enrich_ms":\(String(format: "%.1f", enrichment.enrichMs)),"caption":"\(escapedCaption)","caption_ms":\(String(format: "%.1f", captionMs))}
        """
    }
}
