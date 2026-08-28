import AVFoundation
import CoreImage
import Foundation

/// Grabs one frame from the device and writes it as PNG: the debugging
/// primitive for "what does the Eye actually see".
enum Snapshot {
    static func capture(device: AVCaptureDevice, to path: String) async throws {
        let stream = AsyncStream<UncheckedSendable<CVPixelBuffer>>.makeStream()
        let source = try CameraSource(device: device, fps: 30) { buffer, _ in
            stream.continuation.yield(UncheckedSendable(buffer))
            stream.continuation.finish()
        }
        source.start()
        var first: CVPixelBuffer?
        for await boxed in stream.stream {
            first = boxed.value
            break
        }
        source.stop()
        guard let first else { throw EyeError.noCamera("no frame arrived") }

        let image = CIImage(cvPixelBuffer: first)
        let context = CIContext()
        try context.writePNGRepresentation(
            of: image,
            to: URL(fileURLWithPath: path),
            format: .RGBA8,
            colorSpace: CGColorSpaceCreateDeviceRGB()
        )
    }
}
