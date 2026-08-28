import AVFoundation
import CoreVideo
import Foundation

/// Feeds a video file through the same `process(buffer, ts)` callback the
/// camera uses. Timestamps come from the media timeline mapped onto a
/// base date, so every ts-driven behavior (scene gaps, cooldowns, region
/// maturity) matches a live run while decode races ahead of real time.
/// Same clip, same thresholds, same numbers: that determinism is the
/// harness's whole value.
final class ReplaySource: @unchecked Sendable {
    private let reader: AVAssetReader
    private let output: AVAssetReaderTrackOutput
    private let queue = DispatchQueue(label: "wiki.vedi.eye.replay")
    private let interval: TimeInterval
    private let process: (CVPixelBuffer, Date) -> Void
    private let onFinished: @Sendable () -> Void
    let durationSeconds: Double

    init(
        url: URL,
        fps: Double,
        process: @escaping (CVPixelBuffer, Date) -> Void,
        onFinished: @escaping @Sendable () -> Void
    ) async throws {
        self.interval = 1.0 / fps
        self.process = process
        self.onFinished = onFinished

        let asset = AVURLAsset(url: url)
        guard let track = try await asset.loadTracks(withMediaType: .video).first else {
            throw EyeError.noCamera("no video track in \(url.lastPathComponent)")
        }
        durationSeconds = try await asset.load(.duration).seconds

        reader = try AVAssetReader(asset: asset)
        output = AVAssetReaderTrackOutput(track: track, outputSettings: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
        ])
        output.alwaysCopiesSampleData = false
        guard reader.canAdd(output) else {
            throw EyeError.noCamera("reader rejected \(url.lastPathComponent)")
        }
        reader.add(output)
    }

    func start() {
        let base = Date()
        reader.startReading()
        queue.async { [self] in
            var nextTick: Double = 0
            while reader.status == .reading,
                  let sample = output.copyNextSampleBuffer() {
                let seconds = CMSampleBufferGetPresentationTimeStamp(sample).seconds
                guard seconds >= nextTick,
                      let buffer = CMSampleBufferGetImageBuffer(sample)
                else { continue }
                nextTick = seconds + interval
                process(buffer, base.addingTimeInterval(seconds))
            }
            if reader.status == .failed {
                Log.error("replay: \(reader.error.map { "\($0)" } ?? "reader failed")")
            }
            onFinished()
        }
    }

    func stop() {
        reader.cancelReading()
    }
}
