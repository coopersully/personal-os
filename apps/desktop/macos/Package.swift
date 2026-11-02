// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "PersonalOsNative", platforms: [.macOS(.v14)],
  products: [.library(name: "PersonalOsNative", type: .static, targets: ["PersonalOsNative"])],
  targets: [
    .target(
      name: "PersonalOsNative",
      linkerSettings: [
        .linkedFramework("AppKit"), .linkedFramework("SwiftUI"),
        .linkedFramework("ServiceManagement"), .linkedFramework("Security"),
        .linkedFramework("UserNotifications"), .linkedFramework("WidgetKit"),
      ]), .testTarget(name: "PersonalOsNativeTests", dependencies: ["PersonalOsNative"]),
  ])
