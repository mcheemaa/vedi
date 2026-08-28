import CoreVideo
import Foundation

/// The percept cascade: pHash gate, embed, and salience run synchronously
/// on the capture queue (see CameraSource). Keyframe enrichment hops to
/// its own serial queue so the Eye never drops frames while Vision thinks;
/// the retained pixel buffer briefly outlives its capture slot, which the
/// pool absorbs at single-digit fps.
final class FramePipeline: @unchecked Sendable {
    private let hasher = PerceptualHash()
    private let encoder: ClipEncoder
    private let enricher = VisionEnricher()
    private let jpeg = FrameJPEG()
    private let enrichQueue = DispatchQueue(label: "wiki.vedi.eye.enrich")
    private let frameStore: FrameStore?
    private let captioner: Captioner?
    private let reflexes: PerceptEvents
    private let eventSink: ClickHouseSink
    private let voice: Voice
    private let perceptSink: ClickHouseSink
    private let enrichmentSink: ClickHouseSink
    private let camera: String
    private let eyeSession: UUID
    private let regions: RegionEngine
    private let regionSink: ClickHouseSink
    /// Loop mode: the Brain decides all speech, so canned reflex lines
    /// go silent here and every event also rings the doorbell.
    private let doorbell: Doorbell?
    private let hashDistanceGate: Int
    private let limit: Int
    private let onFinished: @Sendable () -> Void

    private var salience: SalienceGate
    private var lastHash: UInt64?
    private var stats = PipelineStats()
    private var finished = false
    private(set) var framesDispatched = 0
    // Scene and region trackers are capture-queue confined, like salience.
    private var sceneID: UInt32 = 0
    private var lastKeptTs: Date?
    private var lastRegionID: UInt32?
    /// A capture gap longer than this starts a new scene even without a
    /// salience spike (camera covered, sleep, long stillness break).
    private let sceneGapSeconds: TimeInterval = 5
    /// Enrich-queue confined; the same on-screen text repeats across
    /// every frame of a stable scene and is stored only when it changes.
    private var lastOcrHash: Int?
    private var captionScheduler: CaptionScheduler?

    init(
        encoder: ClipEncoder,
        perceptSink: ClickHouseSink,
        enrichmentSink: ClickHouseSink,
        frameStore: FrameStore?,
        captioner: Captioner?,
        eventSink: ClickHouseSink,
        voice: Voice,
        camera: String,
        eyeSession: UUID,
        regions: RegionEngine,
        regionSink: ClickHouseSink,
        doorbell: Doorbell? = nil,
        salience: SalienceGate = SalienceGate(),
        reflexes: PerceptEvents = PerceptEvents(),
        hashDistanceGate: Int,
        limit: Int,
        onFinished: @escaping @Sendable () -> Void
    ) {
        self.encoder = encoder
        self.perceptSink = perceptSink
        self.enrichmentSink = enrichmentSink
        self.frameStore = frameStore
        self.captioner = captioner
        self.eventSink = eventSink
        self.voice = voice
        self.camera = camera
        self.eyeSession = eyeSession
        self.regions = regions
        self.regionSink = regionSink
        self.doorbell = doorbell
        self.salience = salience
        self.reflexes = reflexes
        self.hashDistanceGate = hashDistanceGate
        self.limit = limit
        self.onFinished = onFinished
        if let captioner {
            captionScheduler = CaptionScheduler(captioner: captioner) { [weak self] request, caption in
                self?.deliverCaption(request, caption)
            }
        }
    }

    func warmUp() {
        enrichQueue.sync { enricher.warmUp() }
    }

    func process(_ pixelBuffer: CVPixelBuffer, at ts: Date) {
        guard !finished else { return }
        let start = Date()

        let hash = hasher.hash(pixelBuffer)
        let hashMs = Date().timeIntervalSince(start) * 1000

        if let last = lastHash, PerceptualHash.distance(last, hash) <= hashDistanceGate {
            stats.recordSkip(hashMs: hashMs)
            report()
            return
        }
        lastHash = hash

        do {
            let embedStart = Date()
            let embedding = try encoder.embed(pixelBuffer)
            let embedMs = Date().timeIntervalSince(embedStart) * 1000
            let verdict = salience.assess(embedding)
            let frameID = UUID()

            let gapped = lastKeptTs.map { ts.timeIntervalSince($0) > sceneGapSeconds } ?? true
            let isKeyframe = verdict.isKeyframe || gapped
            if verdict.sceneChanged || gapped {
                sceneID += 1
            }
            if isKeyframe {
                stats.markKeyframe()
            }
            lastKeptTs = ts

            let assignment = regions.assign(embedding, frameID: frameID, ts: ts)
            if let assignment {
                if assignment.born {
                    let event = PerceptEvent(
                        kind: "region_born",
                        detail: "region=\(assignment.regionID) nearest_sim=\(String(format: "%.3f", assignment.sim)) total=\(regions.count())",
                        say: "", frameID: frameID, ts: ts
                    )
                    emit(event, spoken: false)
                    Log.info("REGION born: \(assignment.regionID) (total \(regions.count()))")
                } else if let last = lastRegionID, last != assignment.regionID {
                    let event = PerceptEvent(
                        kind: "region_switch",
                        detail: "\(last) -> \(assignment.regionID) sim=\(String(format: "%.3f", assignment.sim))",
                        say: "", frameID: frameID, ts: ts
                    )
                    emit(event, spoken: false)
                }
                lastRegionID = assignment.regionID
            }
            // Faces and pose cost ~20ms and drive the reflexes, so every
            // motion frame gets them; only salience keyframes earn the
            // expensive caption and a stored original.
            // CVPixelBuffer is CF-retained but not Sendable; the box
            // states what the serial queue guarantees: exclusive access.
            let boxed = UncheckedSendable(pixelBuffer)
            let namingRegion = (assignment?.needsNaming == true) ? assignment?.regionID : nil
            enrichQueue.async { [self] in
                let enrichment = enricher.enrich(boxed.value, accurateOCR: isKeyframe)
                for event in reflexes.assess(
                    enrichment: enrichment, sceneDelta: verdict.delta,
                    frameID: frameID, ts: ts
                ) {
                    let speaks = doorbell == nil && !event.say.isEmpty
                    if speaks {
                        voice.speak(event.say)
                        Log.info("REFLEX \(event.kind): says \"\(event.say)\"  (\(event.detail))")
                    } else {
                        Log.info("REFLEX \(event.kind)  (\(event.detail))")
                    }
                    emit(event, spoken: speaks)
                }
                if let regionID = namingRegion, let captioner {
                    Task { [self] in
                        let name = await captioner.caption(
                            boxed.value,
                            prompt: RegionNamer.prompt,
                            maxTokens: RegionNamer.maxTokens
                        )
                        guard let cleaned = RegionNamer.clean(name?.text ?? "") else {
                            regions.retryNaming(regionID)
                            Log.info("REGION \(regionID) naming retry (raw: \"\((name?.text ?? "").prefix(50))\")")
                            return
                        }
                        regions.setLabel(regionID, label: cleaned)
                        Log.info("REGION \(regionID) named: \"\(cleaned)\"")
                        let event = PerceptEvent(
                            kind: "region_named",
                            detail: "region=\(regionID) label=\(cleaned)",
                            say: "", frameID: frameID, ts: ts
                        )
                        emit(event, spoken: false)
                        for row in regions.dirtyRows() {
                            ship(row.encoded(), to: regionSink)
                        }
                    }
                }
                guard isKeyframe else { return }
                if let frameStore, let encoded = jpeg.encode(boxed.value) {
                    framesDispatched += 1
                    Task {
                        await frameStore.store(
                            frameID: frameID, ts: ts, camera: camera,
                            width: encoded.width, height: encoded.height, jpeg: encoded.data
                        )
                    }
                }
                let request = CaptionScheduler.Request(
                    buffer: boxed, frameID: frameID, ts: ts,
                    enrichment: dedupeOcr(enrichment)
                )
                if let captionScheduler {
                    Task { await captionScheduler.submit(request) }
                } else {
                    deliverCaption(request, nil)
                }
            }

            let e2eMs = Date().timeIntervalSince(start) * 1000
            stats.recordKept(hashMs: hashMs, embedMs: embedMs, e2eMs: e2eMs)
            let row = PerceptRow(
                ts: ts, frameID: frameID, camera: camera, eyeSession: eyeSession,
                phash: hash, hashMs: hashMs, embedMs: embedMs, e2eMs: e2eMs,
                sceneDelta: verdict.delta, keyframe: isKeyframe,
                sceneID: sceneID, regionID: assignment?.regionID ?? 0,
                regionSim: assignment.map { $0.born ? 1 : $0.sim } ?? 0,
                embedding: embedding
            )
            ship(row.encoded(), to: perceptSink)
            if isKeyframe {
                for regionRow in regions.dirtyRows() {
                    ship(regionRow.encoded(), to: regionSink)
                }
            }
            print(String(format: "frame %3d  hash %.1fms  embed %.1fms  delta %.3f  scene %d  region %d%@",
                         stats.frames, hashMs, embedMs, verdict.delta,
                         sceneID, assignment?.regionID ?? 0,
                         isKeyframe ? "  -> keyframe" : ""))
        } catch {
            Log.error("pipeline: embed failed: \(error)")
        }
        report()
    }

    /// Remaining dirty region rows, encoded; called once at shutdown so
    /// the grown brain is fully persisted before exit.
    func flushRegions() -> [String] {
        regions.dirtyRows().map { $0.encoded() }
    }

    /// Settles the enrich queue and drains pending captions so shutdown
    /// never races the last keyframe's row.
    func quiesce() async {
        enrichQueue.sync {}
        if let captionScheduler {
            await captionScheduler.drain()
        }
    }

    func regionCount() -> Int { regions.count() }

    /// Enrich-queue confined. Returns the enrichment with ocr_text
    /// blanked when the normalized text matches the last stored one.
    private func dedupeOcr(_ enrichment: Enrichment) -> Enrichment {
        guard !enrichment.ocrText.isEmpty else { return enrichment }
        let normalized = enrichment.ocrText
            .lowercased()
            .split(separator: " ")
            .joined(separator: " ")
        let hash = normalized.hashValue
        if hash == lastOcrHash {
            return enrichment.withOcrText("")
        }
        lastOcrHash = hash
        return enrichment
    }

    private func deliverCaption(_ request: CaptionScheduler.Request, _ caption: Caption?) {
        let enrichment = request.enrichment
        let row = EnrichmentRow(
            frameID: request.frameID, ts: request.ts, enrichment: enrichment,
            caption: caption?.text ?? "", captionMs: caption?.totalMs ?? 0
        )
        ship(row.encoded(), to: enrichmentSink)
        // What the eyes describe becomes a percept the Brain hears, not
        // just a row it might query later: proactive, not reactive.
        if let caption, !caption.text.isEmpty {
            let described = PerceptEvent(
                kind: "described",
                detail: String(caption.text.prefix(200)),
                say: "", frameID: request.frameID, ts: request.ts
            )
            emit(described, spoken: false)
        }
        let text = enrichment.ocrText.isEmpty ? "-" : String(enrichment.ocrText.prefix(40))
        let said = caption.map { "\"\($0.text.prefix(70))\" (ttft \(Int($0.ttftMs))ms, total \(Int($0.totalMs))ms)" } ?? "no captioner"
        Log.info(String(
            format: "KEYFRAME %@  enrich %.0fms  faces=%d  headFwd=%.2f  ocr=\"%@\"",
            request.frameID.uuidString.prefix(8) as CVarArg,
            enrichment.enrichMs, enrichment.faceCount, enrichment.headForward, text
        ))
        Log.info("  sees: \(said)")
    }

    /// Ships an event to memory and, in loop mode, rings the Brain.
    private func emit(_ event: PerceptEvent, spoken: Bool) {
        ship(event.encoded(spoken: spoken), to: eventSink)
        doorbell?.ring(kind: event.kind, detail: event.detail, frameID: event.frameID, ts: event.ts)
    }

    private func ship(_ line: String, to sink: ClickHouseSink) {
        Task { await sink.add(line) }
    }

    private func report() {
        if stats.frames >= limit, !finished {
            finished = true
            print("\n=== run summary ===")
            print(stats.summary())
            onFinished()
        }
    }
}
