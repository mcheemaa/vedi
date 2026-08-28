import AVFoundation

enum CameraDiscovery {
    /// Built-in, external USB/UVC, and iPhone Continuity cameras alike.
    static func all() -> [AVCaptureDevice] {
        AVCaptureDevice.DiscoverySession(
            deviceTypes: [.builtInWideAngleCamera, .external, .continuityCamera],
            mediaType: .video,
            position: .unspecified
        ).devices
    }

    static func select(matching query: String?) throws -> AVCaptureDevice {
        let devices = all()
        guard !devices.isEmpty else {
            throw EyeError.noCamera("none discovered")
        }
        guard let query, !query.isEmpty else {
            return devices[0]
        }
        guard let match = devices.first(where: {
            $0.localizedName.localizedCaseInsensitiveContains(query)
        }) else {
            let names = devices.map(\.localizedName).joined(separator: ", ")
            throw EyeError.noCamera("no device matching \"\(query)\"; available: \(names)")
        }
        return match
    }
}
