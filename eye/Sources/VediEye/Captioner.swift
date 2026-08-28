import CoreImage
import CoreML
import CoreVideo
import Foundation
import MLXLMCommon
import MLXVLM

struct Caption {
    let text: String
    let ttftMs: Double
    let totalMs: Double
}

/// FastVLM-0.5B on MLX: the keyframe captioner. Loaded once; each caption
/// is one prepare + bounded greedy decode. This is a slot: when macOS 27
/// ships Foundation Models vision, a SystemLanguageModel captioner can
/// replace it behind the same interface.
actor Captioner {
    private let container: ModelContainer
    private let parameters = GenerateParameters(temperature: 0.0)
    private let maxTokens = 48
    private let prompt = "Describe what is in view in one short sentence."

    init(modelDirectory: URL) async throws {
        let towerPackage = modelDirectory.appendingPathComponent("fastvithd.mlpackage")
        FastVLM.visionModelURL = try await MLModel.compileModel(at: towerPackage)
        FastVLM.register(modelFactory: VLMModelFactory.shared)
        container = try await VLMModelFactory.shared.loadContainer(
            configuration: ModelConfiguration(directory: modelDirectory)
        )
    }

    func caption(
        _ pixelBuffer: CVPixelBuffer,
        prompt: String? = nil,
        maxTokens: Int? = nil
    ) async -> Caption? {
        let start = Date()
        let userInput = UserInput(
            prompt: .text(prompt ?? self.prompt),
            images: [.ciImage(CIImage(cvPixelBuffer: pixelBuffer))]
        )
        do {
            let maxTokens = maxTokens ?? self.maxTokens
            nonisolated(unsafe) var ttftMs: Double = 0
            let result = try await container.perform { context in
                let input = try await context.processor.prepare(input: userInput)
                var seenFirst = false
                return try MLXLMCommon.generate(
                    input: input, parameters: parameters, context: context
                ) { tokens in
                    if !seenFirst {
                        seenFirst = true
                        ttftMs = Date().timeIntervalSince(start) * 1000
                    }
                    return tokens.count >= maxTokens ? .stop : .more
                }
            }
            let text = result.output.trimmingCharacters(in: .whitespacesAndNewlines)
            return Caption(text: text, ttftMs: ttftMs, totalMs: Date().timeIntervalSince(start) * 1000)
        } catch {
            Log.error("captioner: \(error)")
            return nil
        }
    }
}
