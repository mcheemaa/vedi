import AVFoundation
import CoreVideo

enum CameraLifecycle: Sendable {
    case lost(String)
    case recovered
}

/// Owns the capture session and delivers frames, throttled to the target
/// fps, synchronously on the capture queue. The whole spike pipeline runs
/// inside that callback: at single-digit fps the work (hash + encode,
/// milliseconds) fits comfortably, and staying on one queue avoids moving
/// non-Sendable CVPixelBuffers across isolation domains.
///
/// Sleep, hotplug, and Continuity handoffs kill capture sessions without
/// asking; an Eye that goes silently blind poisons the memory, so session
/// death is observed, retried, and reported as lifecycle events the agent
/// can read back ("I was blind from 2:10 to 2:14").
final class CameraSource: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate, @unchecked Sendable {
    private let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "wiki.vedi.eye.capture")
    private let minInterval: TimeInterval
    private let process: (CVPixelBuffer, Date) -> Void
    private var lastAccepted = Date.distantPast
    /// Set before start(); called on an arbitrary queue.
    var onLifecycle: (@Sendable (CameraLifecycle) -> Void)?
    private var retryTimer: DispatchSourceTimer?
    private let retryInterval: TimeInterval = 2
    private var firstFrameAt: Date?
    /// The camera's auto-exposure ramps from black over the first frames
    /// of a session; those are artifacts of the hardware, not the scene,
    /// and they polluted the region space as a junk "black" region.
    private let settleSeconds: TimeInterval = 0.7

    init(device: AVCaptureDevice, fps: Double, process: @escaping (CVPixelBuffer, Date) -> Void) throws {
        self.minInterval = 1.0 / fps
        self.process = process
        super.init()

        let input = try AVCaptureDeviceInput(device: device)
        let output = AVCaptureVideoDataOutput()
        output.alwaysDiscardsLateVideoFrames = true
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]

        session.beginConfiguration()
        session.sessionPreset = .hd1280x720
        guard session.canAddInput(input), session.canAddOutput(output) else {
            throw EyeError.noCamera("session rejected \(device.localizedName)")
        }
        session.addInput(input)
        session.addOutput(output)
        session.commitConfiguration()
        output.setSampleBufferDelegate(self, queue: queue)
        observeSessionDeath()
    }

    func start() { session.startRunning() }

    func stop() {
        retryTimer?.cancel()
        retryTimer = nil
        NotificationCenter.default.removeObserver(self)
        session.stopRunning()
    }

    // MARK: - Session death and recovery

    private func observeSessionDeath() {
        let center = NotificationCenter.default
        center.addObserver(
            self, selector: #selector(sessionFailed(_:)),
            name: .AVCaptureSessionRuntimeError, object: session
        )
        center.addObserver(
            self, selector: #selector(sessionInterrupted(_:)),
            name: .AVCaptureSessionWasInterrupted, object: session
        )
        center.addObserver(
            self, selector: #selector(sessionResumed),
            name: .AVCaptureSessionInterruptionEnded, object: session
        )
    }

    @objc private func sessionFailed(_ notification: Notification) {
        let error = notification.userInfo?[AVCaptureSessionErrorKey] as? Error
        onLifecycle?(.lost(error.map { "\($0)" } ?? "runtime error"))
        beginRetry()
    }

    @objc private func sessionInterrupted(_ notification: Notification) {
        onLifecycle?(.lost("interrupted"))
    }

    @objc private func sessionResumed() {
        onLifecycle?(.recovered)
    }

    private func beginRetry() {
        guard retryTimer == nil else { return }
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + retryInterval, repeating: retryInterval)
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            if self.session.isRunning {
                self.retryTimer?.cancel()
                self.retryTimer = nil
                self.onLifecycle?(.recovered)
            } else {
                self.session.startRunning()
            }
        }
        timer.resume()
        retryTimer = timer
    }

    nonisolated func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        let now = Date()
        if firstFrameAt == nil { firstFrameAt = now }
        guard now.timeIntervalSince(firstFrameAt ?? now) >= settleSeconds,
              now.timeIntervalSince(lastAccepted) >= minInterval,
              let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer)
        else { return }
        lastAccepted = now
        process(pixelBuffer, now)
    }
}
