import CoreImage
import CoreVideo
import Foundation

/// Downscaled JPEG encoding for keyframe originals. 640px on the long
/// side at 0.7 quality lands near 40-80KB: enough for a vision model to
/// re-read later, cheap enough to keep every keyframe forever.
struct FrameJPEG {
    private let context = CIContext(options: [.cacheIntermediates: false])
    private let maxSide: CGFloat = 640

    struct Encoded {
        let data: Data
        let width: Int
        let height: Int
    }

    func encode(_ pixelBuffer: CVPixelBuffer) -> Encoded? {
        var image = CIImage(cvPixelBuffer: pixelBuffer)
        let longSide = max(image.extent.width, image.extent.height)
        if longSide > maxSide {
            let scale = maxSide / longSide
            image = image.transformed(by: .init(scaleX: scale, y: scale))
        }
        guard let data = context.jpegRepresentation(
            of: image,
            colorSpace: CGColorSpaceCreateDeviceRGB(),
            options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.7]
        ) else { return nil }
        return Encoded(data: data, width: Int(image.extent.width), height: Int(image.extent.height))
    }
}
