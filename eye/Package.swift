// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "VediEye",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(url: "https://github.com/ml-explore/mlx-swift-examples", exact: "2.21.2"),
        // Era-correct transitive pin: MLXLMCommon 2.21.2 predates the
        // swift-transformers Config API change and breaks against newer.
        .package(url: "https://github.com/huggingface/swift-transformers", exact: "0.1.14")
    ],
    targets: [
        .executableTarget(
            name: "VediEye",
            dependencies: [
                .product(name: "MLXLMCommon", package: "mlx-swift-examples"),
                .product(name: "MLXVLM", package: "mlx-swift-examples"),
            ],
            exclude: ["Info.plist"],
            linkerSettings: [
                // A bare executable has no bundle Info.plist; TCC reads the
                // camera usage description from an embedded __info_plist
                // section instead.
                .unsafeFlags([
                    "-Xlinker", "-sectcreate",
                    "-Xlinker", "__TEXT",
                    "-Xlinker", "__info_plist",
                    "-Xlinker", "Sources/VediEye/Info.plist",
                ])
            ]
        )
    ]
)
