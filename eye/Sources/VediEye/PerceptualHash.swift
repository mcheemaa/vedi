import CoreImage
import CoreVideo

/// 64-bit difference hash: downscale to 9x8 luminance, compare horizontal
/// neighbors. Near-identical frames land within a few bits of each other,
/// which is the gate that makes a still scene free.
struct PerceptualHash {
    private let context = CIContext(options: [.cacheIntermediates: false])

    func hash(_ pixelBuffer: CVPixelBuffer) -> UInt64 {
        let image = CIImage(cvPixelBuffer: pixelBuffer)
        let scaleX = 9.0 / image.extent.width
        let scaleY = 8.0 / image.extent.height
        let tiny = image.transformed(by: .init(scaleX: scaleX, y: scaleY))

        var gray = [UInt8](repeating: 0, count: 9 * 8)
        context.render(
            tiny,
            toBitmap: &gray,
            rowBytes: 9,
            bounds: CGRect(x: 0, y: 0, width: 9, height: 8),
            format: .L8,
            colorSpace: CGColorSpaceCreateDeviceGray()
        )

        var bits: UInt64 = 0
        for row in 0..<8 {
            for col in 0..<8 {
                bits <<= 1
                if gray[row * 9 + col] > gray[row * 9 + col + 1] {
                    bits |= 1
                }
            }
        }
        return bits
    }

    static func distance(_ a: UInt64, _ b: UInt64) -> Int {
        (a ^ b).nonzeroBitCount
    }
}
