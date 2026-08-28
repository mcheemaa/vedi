import Foundation

struct SalienceVerdict {
    let delta: Float
    /// This frame is a scene's settled representative: store it, caption it.
    let isKeyframe: Bool
    /// A sustained transition just ended here: a new scene begins.
    let sceneChanged: Bool
}

/// Compares each embedding against an exponential moving average of the
/// recent scene and runs a settle state machine on top. The old gate
/// keyframed the SPIKE, which is the blurriest moment of a change; this
/// one keyframes the SETTLE, when the new scene is what the frame shows.
/// A one-frame blip settles without starting a new scene, which is what
/// collapsed 59 scenes in a 4-minute run to a handful.
struct SalienceGate {
    private enum Phase {
        case stable
        case transitioning(frames: Int)
    }

    private var sceneMean: [Float]?
    private var phase: Phase = .stable
    private let smoothing: Float
    private let enterThreshold: Float
    /// Below this the transition is over; hysteresis under enterThreshold
    /// so the machine cannot oscillate on boundary deltas.
    private let settleThreshold: Float
    /// A transition this long counts as a scene change when it settles.
    private let sustainedFrames: Int
    /// Continuous motion never settles on its own; force a representative
    /// frame out after this many transition frames.
    private let forceSettleFrames: Int

    init(
        enterThreshold: Float = 0.10,
        settleThreshold: Float = 0.06,
        smoothing: Float = 0.3,
        sustainedFrames: Int = 2,
        forceSettleFrames: Int = 25
    ) {
        self.enterThreshold = enterThreshold
        self.settleThreshold = settleThreshold
        self.smoothing = smoothing
        self.sustainedFrames = sustainedFrames
        self.forceSettleFrames = forceSettleFrames
    }

    mutating func assess(_ embedding: [Float]) -> SalienceVerdict {
        let unit = Self.normalized(embedding)
        guard var mean = sceneMean else {
            sceneMean = unit
            return SalienceVerdict(delta: 1.0, isKeyframe: true, sceneChanged: true)
        }

        let delta = 1.0 - Self.dot(unit, Self.normalized(mean))
        for i in 0..<mean.count {
            mean[i] += smoothing * (unit[i] - mean[i])
        }
        sceneMean = mean

        switch phase {
        case .stable:
            if delta >= enterThreshold {
                phase = .transitioning(frames: 1)
            }
            return SalienceVerdict(delta: delta, isKeyframe: false, sceneChanged: false)

        case .transitioning(let frames):
            if delta < settleThreshold {
                phase = .stable
                return SalienceVerdict(
                    delta: delta,
                    isKeyframe: true,
                    sceneChanged: frames >= sustainedFrames
                )
            }
            if frames + 1 >= forceSettleFrames {
                phase = .stable
                return SalienceVerdict(delta: delta, isKeyframe: true, sceneChanged: true)
            }
            phase = .transitioning(frames: frames + 1)
            return SalienceVerdict(delta: delta, isKeyframe: false, sceneChanged: false)
        }
    }

    private static func dot(_ a: [Float], _ b: [Float]) -> Float {
        var sum: Float = 0
        for i in 0..<min(a.count, b.count) { sum += a[i] * b[i] }
        return sum
    }

    private static func normalized(_ v: [Float]) -> [Float] {
        let norm = max(sqrt(dot(v, v)), .leastNormalMagnitude)
        return v.map { $0 / norm }
    }
}
