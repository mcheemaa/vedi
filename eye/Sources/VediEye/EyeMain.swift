import AVFoundation
import Foundation

@main
struct EyeMain {
    static func main() async {
        do {
            try await run()
        } catch {
            print("vedi-eye: \(error)")
            exit(1)
        }
    }

    static func run() async throws {
        let args = CommandLine.arguments

        if args.contains("--list-devices") {
            for device in CameraDiscovery.all() {
                print("\(device.localizedName)  [\(device.deviceType.rawValue)]")
            }
            return
        }

        if let text = value(of: "--tokenize", in: args) {
            let tokenizer = try ClipTextTokenizer(
                url: URL(fileURLWithPath: "Models/clip_tokenizer.json"))
            let tokens = tokenizer.tokenize(text)
            let used = tokens.prefix(while: { $0 != 0 })
            print("tokens: \(Array(used))")
            return
        }

        // Co-process mode: the Brain spawns this once and writes one query
        // per line; the model stays loaded so each embed is milliseconds.
        // stdin/stdout instead of a server: no ports, no HTTP, no deps.
        if args.contains("--embed-stdin") {
            let encoder = try ClipTextEncoder(
                packageURL: URL(fileURLWithPath: "Models/mobileclip_s2_text.mlpackage"),
                tokenizerURL: URL(fileURLWithPath: "Models/clip_tokenizer.json")
            )
            FileHandle.standardOutput.write("ready\n".data(using: .utf8)!)
            while let line = readLine(strippingNewline: true) {
                guard !line.isEmpty else { continue }
                let vector = (try? encoder.embed(line)) ?? []
                let joined = vector.map { String(format: "%.6f", $0) }.joined(separator: ",")
                FileHandle.standardOutput.write("[\(joined)]\n".data(using: .utf8)!)
            }
            return
        }

        if let query = value(of: "--embed-text", in: args) {
            let encoder = try ClipTextEncoder(
                packageURL: URL(fileURLWithPath: value(of: "--text-model", in: args)
                    ?? "Models/mobileclip_s2_text.mlpackage"),
                tokenizerURL: URL(fileURLWithPath: "Models/clip_tokenizer.json")
            )
            let start = Date()
            let embedding = try encoder.embed(query)
            let ms = Date().timeIntervalSince(start) * 1000
            let vector = embedding.map { String(format: "%.6f", $0) }.joined(separator: ",")
            print("{\"query\":\"\(query)\",\"embed_ms\":\(String(format: "%.1f", ms)),\"embedding\":[\(vector)]}")
            return
        }

        // Replay mode: a video file stands in for the camera, all sinks
        // write to the lab database, and nothing touches the live memory.
        let replayPath = value(of: "--replay", in: args)
        let db = replayPath != nil ? (value(of: "--lab-db", in: args) ?? "vedi_lab") : "vedi"

        var device: AVCaptureDevice?
        if replayPath == nil {
            let selected = try CameraDiscovery.select(matching: value(of: "--device", in: args))
            if let snapshotPath = value(of: "--snapshot", in: args) {
                guard await AVCaptureDevice.requestAccess(for: .video) else {
                    throw EyeError.noCamera("camera permission denied")
                }
                try await Snapshot.capture(device: selected, to: snapshotPath)
                Log.info("snapshot from \"\(selected.localizedName)\" written to \(snapshotPath)")
                return
            }
            guard await AVCaptureDevice.requestAccess(for: .video) else {
                throw EyeError.noCamera("camera permission denied")
            }
            device = selected
        }

        let fps = Double(value(of: "--fps", in: args) ?? "5") ?? 5
        let watch = args.contains("--watch")
        let limit = (replayPath != nil || watch) ? Int.max : (Int(value(of: "--limit", in: args) ?? "60") ?? 60)
        let gate = Int(value(of: "--gate", in: args) ?? "3") ?? 3
        let modelPath = value(of: "--model", in: args) ?? "Models/mobileclip_s2_image.mlpackage"
        let tauAssign = Float(value(of: "--tau-assign", in: args) ?? "") ?? 0.80
        let salienceEnter = Float(value(of: "--salience-enter", in: args) ?? "") ?? 0.10
        let salienceSettle = Float(value(of: "--salience-settle", in: args) ?? "") ?? 0.06
        let debounceFrames = Int(value(of: "--debounce-frames", in: args) ?? "") ?? 3

        let cameraName: String
        if let replayPath {
            cameraName = "replay:\((replayPath as NSString).lastPathComponent)"
            print("vedi-eye: replay \"\(replayPath)\" into \(db), \(fps) fps sampling, gate \(gate) bits, tau \(tauAssign), salience \(salienceEnter)/\(salienceSettle), debounce \(debounceFrames)")
        } else if let device {
            cameraName = device.localizedName
            print("vedi-eye: device \"\(cameraName)\", \(fps) fps, limit \(limit) frames, gate \(gate) bits")
        } else {
            throw EyeError.noCamera("no capture source resolved")
        }

        let env = try EnvFile.locate()
        let eyeSession = UUID()
        let loadStart = Date()
        let encoder = try ClipEncoder(packageURL: URL(fileURLWithPath: modelPath))
        print(String(format: "model compiled + loaded in %.0fms", Date().timeIntervalSince(loadStart) * 1000))
        let perceptSink = try ClickHouseSink(env: env, table: "\(db).percepts")
        let enrichmentSink = try ClickHouseSink(env: env, table: "\(db).enrichments", flushEvery: 1, waitForAck: true)
        let eventSink = try ClickHouseSink(env: env, table: "\(db).events", flushEvery: 1, waitForAck: true)
        let regionSink = try ClickHouseSink(env: env, table: "\(db).regions", flushEvery: 1, waitForAck: true)
        let voice = Voice(
            enabled: replayPath == nil && args.contains("--speak"),
            voiceName: value(of: "--voice", in: args)
        )

        let regionEngine = RegionEngine(tauAssign: tauAssign)
        // A replay run starts with an empty brain so identical inputs
        // give identical numbers; --keep-brain continues across clips.
        if replayPath == nil || args.contains("--keep-brain") {
            do {
                let persisted = try await ClickHouseQuery.rows(
                    env: env,
                    sql: "SELECT region_id, centroid, member_count, first_seen, last_seen, exemplar_frame_id, label, status FROM \(db).regions FINAL"
                )
                regionEngine.load(persisted)
                Log.info("regions reloaded: \(regionEngine.count()) (the brain never resets)")
            } catch {
                Log.warn("regions: reload failed, starting empty: \(error)")
            }
        }

        var frameStore: FrameStore?
        var doorbell: Doorbell?
        let brainURL = env["BRAIN_URL"] ?? (env["POSTGRES_URL"] != nil ? "http://127.0.0.1:8484" : nil)
        if replayPath == nil, let brainURL {
            frameStore = try FrameStore(brainURL: brainURL)
            Log.info("frame store shipping to brain at \(brainURL)")
            if args.contains("--loop") {
                doorbell = Doorbell(brainURL: brainURL)
                Log.info("loop mode: the Brain decides all speech; canned reflex lines silenced")
            }
        }

        var captioner: Captioner?
        let modelDir = URL(fileURLWithPath: "Models/fastvlm-0.5b")
        if FileManager.default.fileExists(atPath: modelDir.path) {
            let capStart = Date()
            let loaded = try await Captioner(modelDirectory: modelDir)
            var blank: CVPixelBuffer?
            CVPixelBufferCreate(nil, 64, 64, kCVPixelFormatType_32BGRA, nil, &blank)
            if let blank {
                _ = await loaded.caption(blank, maxTokens: 1)
            }
            captioner = loaded
            Log.info(String(format: "captioner (FastVLM-0.5B) loaded + warmed in %.0fms", Date().timeIntervalSince(capStart) * 1000))
        } else {
            Log.warn("captioner: Models/fastvlm-0.5b not found, captions disabled")
        }

        let started = LifecycleEvent(
            kind: "eye_started",
            detail: "session=\(eyeSession.uuidString) source=\(cameraName) fps=\(fps)",
            ts: Date()
        )
        await eventSink.add(started.encoded())

        let done = AsyncStream<Void>.makeStream()
        let pipeline = FramePipeline(
            encoder: encoder,
            perceptSink: perceptSink,
            enrichmentSink: enrichmentSink,
            frameStore: frameStore,
            captioner: captioner,
            eventSink: eventSink,
            voice: voice,
            camera: cameraName,
            eyeSession: eyeSession,
            regions: regionEngine,
            regionSink: regionSink,
            doorbell: doorbell,
            salience: SalienceGate(enterThreshold: salienceEnter, settleThreshold: salienceSettle),
            reflexes: PerceptEvents(confirmFrames: debounceFrames),
            hashDistanceGate: gate,
            limit: limit,
            onFinished: { done.continuation.finish() }
        )

        let warmStart = Date()
        pipeline.warmUp()
        Log.info(String(format: "vision enrichers warmed in %.0fms", Date().timeIntervalSince(warmStart) * 1000))

        // Declared at function scope: sources must outlive the await below
        // or handlers die with their block and Ctrl-C goes ignored.
        var camera: CameraSource?
        var replay: ReplaySource?
        var sigint: DispatchSourceSignal?

        if let replayPath {
            let source = try await ReplaySource(
                url: URL(fileURLWithPath: replayPath),
                fps: fps,
                process: { buffer, ts in pipeline.process(buffer, at: ts) },
                onFinished: { done.continuation.finish() }
            )
            Log.info(String(format: "replay: %.0fs of video, sampling at %.0f fps", source.durationSeconds, fps))
            replay = source
            source.start()
        } else if let device {
            let source = try CameraSource(device: device, fps: fps) { buffer, ts in
                pipeline.process(buffer, at: ts)
            }
            source.onLifecycle = { lifecycle in
                let event: LifecycleEvent
                switch lifecycle {
                case .lost(let reason):
                    Log.warn("camera lost: \(reason)")
                    event = LifecycleEvent(
                        kind: "camera_lost",
                        detail: "session=\(eyeSession.uuidString) reason=\(reason.prefix(120))",
                        ts: Date()
                    )
                case .recovered:
                    Log.info("camera recovered")
                    event = LifecycleEvent(
                        kind: "camera_recovered",
                        detail: "session=\(eyeSession.uuidString)",
                        ts: Date()
                    )
                }
                Task { await eventSink.add(event.encoded()) }
            }
            if watch {
                signal(SIGINT, SIG_IGN)
                let signalSource = DispatchSource.makeSignalSource(
                    signal: SIGINT, queue: DispatchQueue(label: "wiki.vedi.eye.signal"))
                nonisolated(unsafe) var pressed = false
                signalSource.setEventHandler {
                    if pressed { exit(130) }
                    pressed = true
                    Log.info("stopping (Ctrl-C again to force)")
                    done.continuation.finish()
                }
                signalSource.resume()
                sigint = signalSource
                Log.info("watch mode: running until Ctrl-C")
            }
            camera = source
            source.start()
        }
        for await _ in done.stream {}
        camera?.stop()
        replay?.stop()
        sigint?.cancel()
        await pipeline.quiesce()

        let stopped = LifecycleEvent(
            kind: "eye_stopped",
            detail: "session=\(eyeSession.uuidString) frames=\(pipeline.framesDispatched)",
            ts: Date()
        )
        await eventSink.add(stopped.encoded())

        for line in pipeline.flushRegions() {
            await regionSink.add(line)
        }
        await perceptSink.flush()
        await enrichmentSink.flush()
        await eventSink.flush()
        await regionSink.flush()
        let percepts = await perceptSink.totalShipped()
        let enrichments = await enrichmentSink.totalShipped()
        if let frameStore {
            await frameStore.drain(expecting: pipeline.framesDispatched)
            let stored = await frameStore.totalStored()
            Log.info("shipped: \(percepts) percepts, \(enrichments) enrichments to ClickHouse; \(stored) frames to Postgres")
        } else {
            Log.info("shipped to \(db): \(percepts) percepts, \(enrichments) enrichments")
        }
        if replayPath != nil {
            let events = await eventSink.totalShipped()
            Log.info("replay result: \(pipeline.regionCount()) regions grown, \(events) events; details in \(db)")
        }
    }

    private static func value(of flag: String, in args: [String]) -> String? {
        guard let index = args.firstIndex(of: flag), index + 1 < args.count else { return nil }
        return args[index + 1]
    }
}
