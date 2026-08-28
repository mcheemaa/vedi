import CoreML
import Foundation

/// MobileCLIP text tower via CoreML: the other half of the shared space.
/// One call turns a phrase into a vector comparable against every frame
/// embedding ever stored; recall, standing queries, and region naming
/// all ride on this. IO names are introspected like the image tower's.
final class ClipTextEncoder {
    private let model: MLModel
    private let tokenizer: ClipTextTokenizer
    private let inputName: String
    private let outputName: String

    init(packageURL: URL, tokenizerURL: URL) throws {
        tokenizer = try ClipTextTokenizer(url: tokenizerURL)

        let compiled = try MLModel.compileModel(at: packageURL)
        let config = MLModelConfiguration()
        config.computeUnits = .all
        model = try MLModel(contentsOf: compiled, configuration: config)

        guard let input = model.modelDescription.inputDescriptionsByName
            .first(where: { $0.value.type == .multiArray })
        else {
            throw EyeError.modelIO("no multiarray input found in text model description")
        }
        inputName = input.key
        guard let output = model.modelDescription.outputDescriptionsByName
            .first(where: { $0.value.type == .multiArray })
        else {
            throw EyeError.modelIO("no multiarray output found in text model description")
        }
        outputName = output.key
    }

    func embed(_ text: String) throws -> [Float] {
        let tokens = tokenizer.tokenize(text)
        let shape: [NSNumber] = [1, NSNumber(value: tokenizer.contextLength)]
        let array = try MLMultiArray(shape: shape, dataType: .int32)
        for (i, token) in tokens.enumerated() {
            array[i] = NSNumber(value: token)
        }

        let provider = try MLDictionaryFeatureProvider(dictionary: [
            inputName: MLFeatureValue(multiArray: array)
        ])
        let result = try model.prediction(from: provider)
        guard let output = result.featureValue(for: outputName)?.multiArrayValue else {
            throw EyeError.modelIO("output \(outputName) missing from text prediction")
        }
        var embedding = [Float](repeating: 0, count: output.count)
        for i in 0..<output.count {
            embedding[i] = output[i].floatValue
        }
        return embedding
    }
}
