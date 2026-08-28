import CoreVideo
import Foundation

/// Serializes captioning with a latest-wins queue of depth one. Scene
/// flips faster than the model can describe them would otherwise stack
/// seconds of stale work on the actor; describing the newest settled
/// scene is always worth more than finishing a superseded one.
actor CaptionScheduler {
    struct Request: Sendable {
        let buffer: UncheckedSendable<CVPixelBuffer>
        let frameID: UUID
        let ts: Date
        let enrichment: Enrichment
    }

    private let captioner: Captioner
    private let deliver: @Sendable (Request, Caption?) -> Void
    private var inFlight = false
    private var pending: Request?
    private var dropped = 0

    init(captioner: Captioner, deliver: @escaping @Sendable (Request, Caption?) -> Void) {
        self.captioner = captioner
        self.deliver = deliver
    }

    func submit(_ request: Request) {
        guard !inFlight else {
            if pending != nil { dropped += 1 }
            pending = request
            return
        }
        inFlight = true
        Task { await run(request) }
    }

    func droppedCount() -> Int { dropped }

    /// Waits for in-flight and pending work so shutdown never drops the
    /// last scene's caption row.
    func drain() async {
        while inFlight || pending != nil {
            try? await Task.sleep(nanoseconds: 50_000_000)
        }
    }

    private func run(_ request: Request) async {
        let caption = await captioner.caption(request.buffer.value)
        deliver(request, caption)
        if let next = pending {
            pending = nil
            Task { await run(next) }
        } else {
            inFlight = false
        }
    }
}
