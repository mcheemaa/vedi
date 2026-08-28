import CoreVideo
import Foundation
import Vision

struct Enrichment {
    let ocrText: String
    let faceCount: Int
    /// Nose offset ahead of the shoulder midline, normalized by shoulder
    /// width. Grows as the head drifts forward of the torso: the tech-neck
    /// signal, cheap and honest, no model download.
    let headForward: Float
    let enrichMs: Double

    func withOcrText(_ text: String) -> Enrichment {
        Enrichment(ocrText: text, faceCount: faceCount, headForward: headForward, enrichMs: enrichMs)
    }
}

struct VisionEnricher {
    /// Below this the recognized text is UI chrome and single glyphs,
    /// not content worth remembering.
    private let minTextLength = 10

    /// Vision lazy-loads its detector networks on first perform (measured:
    /// 6.1s). One throwaway pass at startup moves that cost out of the
    /// first real keyframe.
    func warmUp() {
        var blank: CVPixelBuffer?
        CVPixelBufferCreate(nil, 64, 64, kCVPixelFormatType_32BGRA, nil, &blank)
        if let blank {
            _ = enrich(blank)
        }
    }

    /// Fast OCR keeps the reflex tier cheap on every motion frame;
    /// keyframes pay for .accurate because their text is what recall
    /// reads back later.
    func enrich(_ pixelBuffer: CVPixelBuffer, accurateOCR: Bool = false) -> Enrichment {
        let start = Date()
        let ocr = VNRecognizeTextRequest()
        ocr.recognitionLevel = accurateOCR ? .accurate : .fast
        ocr.usesLanguageCorrection = accurateOCR
        let faces = VNDetectFaceRectanglesRequest()
        let pose = VNDetectHumanBodyPoseRequest()

        let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer)
        try? handler.perform([ocr, faces, pose])

        var text = (ocr.results ?? [])
            .compactMap { $0.topCandidates(1).first?.string }
            .joined(separator: " ")
        if text.count < minTextLength { text = "" }

        return Enrichment(
            ocrText: text,
            faceCount: faces.results?.count ?? 0,
            headForward: Self.headForward(from: pose.results?.first),
            enrichMs: Date().timeIntervalSince(start) * 1000
        )
    }

    private static func headForward(from observation: VNHumanBodyPoseObservation?) -> Float {
        guard let observation,
              let nose = try? observation.recognizedPoint(.nose),
              let left = try? observation.recognizedPoint(.leftShoulder),
              let right = try? observation.recognizedPoint(.rightShoulder),
              nose.confidence > 0.3, left.confidence > 0.3, right.confidence > 0.3
        else { return 0 }

        let shoulderWidth = abs(left.location.x - right.location.x)
        guard shoulderWidth > 0.01 else { return 0 }
        let midX = (left.location.x + right.location.x) / 2
        return Float(abs(nose.location.x - midX) / shoulderWidth)
    }
}
