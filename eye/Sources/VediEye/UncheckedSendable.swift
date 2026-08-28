/// Wraps a value whose thread-safety is guaranteed structurally (a serial
/// queue, exclusive handoff) rather than by its type.
struct UncheckedSendable<Value>: @unchecked Sendable {
    let value: Value
    init(_ value: Value) { self.value = value }
}
