// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "IloNative", platforms: [.macOS(.v14)],
  products: [.library(name: "IloNative", type: .static, targets: ["IloNative"])],
  targets: [
    .target(
      name: "IloNative",
      linkerSettings: [
        .linkedFramework("AppKit"), .linkedFramework("SwiftUI"),
        .linkedFramework("ServiceManagement"), .linkedFramework("Security"),
        .linkedFramework("UserNotifications"), .linkedFramework("WidgetKit"),
      ]), .testTarget(name: "IloNativeTests", dependencies: ["IloNative"]),
  ])
