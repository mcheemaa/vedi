import CoreImage
import CoreML
import CoreVideo

/// MobileCLIP image tower via CoreML. Input name, size, and output name are
/// read from the compiled model's own description rather than assumed, so a
/// model swap (S2 today, MobileCLIP2 tomorrow) is a file path change.
final class ClipEncoder {
    private let model: MLModel
    private let inputName: String
    private let outputName: String
    private let side: Int
    private let context = CIContext(options: [.cacheIntermediates: false])

    init(packageURL: URL) throws {
        let compiled = try MLModel.compileModel(at: packageURL)
        let config = MLModelConfiguration()
        config.computeUnits = .all
        model = try MLModel(contentsOf: compiled, configuration: config)

        guard let input = model.modelDescription.inputDescriptionsByName.first(where: { $0.value.type == .image }),
              let constraint = input.value.imageConstraint
        else {
            throw EyeError.modelIO("no image input found in model description")
        }
        inputName = input.key
        side = constraint.pixelsWide
        guard let output = model.modelDescription.outputDescriptionsByName.first(where: { $0.value.type == .multiArray }) else {
            throw EyeError.modelIO("no multiarray output found in model description")
        }
        outputName = output.key
    }

    func embed(_ pixelBuffer: CVPixelBuffer) throws -> [Float] {
        let resized = try resize(pixelBuffer)
        let value = MLFeatureValue(pixelBuffer: resized)
        let provider = try MLDictionaryFeatureProvider(dictionary: [inputName: value])
        let result = try model.prediction(from: provider)
        guard let array = result.featureValue(for: outputName)?.multiArrayValue else {
            throw EyeError.modelIO("output \(outputName) missing from prediction")
        }
        var embedding = [Float](repeating: 0, count: array.count)
        for i in 0..<array.count {
            embedding[i] = array[i].floatValue
        }
        return embedding
    }

    private func resize(_ pixelBuffer: CVPixelBuffer) throws -> CVPixelBuffer {
        let image = CIImage(cvPixelBuffer: pixelBuffer)
        let scale = CGFloat(side) / min(image.extent.width, image.extent.height)
        let scaled = image.transformed(by: .init(scaleX: scale, y: scale))
        let cropped = scaled.cropped(to: CGRect(
            x: scaled.extent.midX - CGFloat(side) / 2,
            y: scaled.extent.midY - CGFloat(side) / 2,
            width: CGFloat(side),
            height: CGFloat(side)
        ))

        var target: CVPixelBuffer?
        CVPixelBufferCreate(nil, side, side, kCVPixelFormatType_32BGRA, nil, &target)
        guard let target else {
            throw EyeError.modelIO("could not allocate \(side)x\(side) buffer")
        }
        context.render(cropped, to: target)
        return target
    }
}
