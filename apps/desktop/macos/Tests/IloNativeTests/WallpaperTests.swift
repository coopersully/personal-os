import AppKit
import XCTest

@testable import IloNative

final class WallpaperTests: XCTestCase {
  func options(_ fit: String = "preserve", layout: String = "grid") -> WallpaperOptions {
    WallpaperOptions(
      backgroundColor: "#ffffff", backgroundMode: "white", cornerRadius: 8, frameSpacing: 12,
      layout: layout, mosaicFit: fit, paddingBottom: 20, paddingEnd: 30, paddingStart: 40,
      paddingTop: 50, tileSize: 64, rotationDegrees: 0)
  }
  func testPreserveRetainsAspectAndRetinaScalesSpacing() throws {
    let ratios = [0.5, 1, 2, 1.5, 0.75, 1]
    let normal = try WallpaperLayout.tiles(
      options(), size: CGSize(width: 1440, height: 900), scale: 1, ratios: ratios)
    let retina = try WallpaperLayout.tiles(
      options(), size: CGSize(width: 2880, height: 1800), scale: 2, ratios: ratios)
    XCTAssertEqual(normal.count, 6)
    for (a, b) in zip(normal, retina) {
      XCTAssertEqual(a.frame.height / a.frame.width, ratios[a.index], accuracy: 0.00001)
      XCTAssertEqual(a.frame.minX * 2, b.frame.minX, accuracy: 0.00001)
      XCTAssertEqual(a.frame.minY * 2, b.frame.minY, accuracy: 0.00001)
      XCTAssertEqual(a.frame.width * 2, b.frame.width, accuracy: 0.00001)
      XCTAssertGreaterThanOrEqual(a.frame.minX, 40)
      XCTAssertGreaterThanOrEqual(a.frame.minY, 50)
      XCTAssertLessThanOrEqual(a.frame.maxX, 1410.001)
      XCTAssertLessThanOrEqual(a.frame.maxY, 880.001)
    }
  }
  func testFillCoversPaddedColumnsExactly() throws {
    let tiles = try WallpaperLayout.tiles(
      options("fill"), size: CGSize(width: 1920, height: 1080), scale: 1,
      ratios: [0.5, 1, 2, 1.5, 0.75, 1, 1])
    XCTAssertTrue(tiles.allSatisfy(\.cover))
    XCTAssertEqual(tiles.map(\.frame.minX).min(), 40)
    XCTAssertEqual(tiles.map(\.frame.maxX).max()!, 1890, accuracy: 0.0001)
    XCTAssertEqual(tiles.map(\.frame.minY).min(), 50)
    XCTAssertEqual(tiles.map(\.frame.maxY).max()!, 1060, accuracy: 0.0001)
    let crop = WallpaperLayout.crop(
      source: CGSize(width: 400, height: 200), target: CGSize(width: 100, height: 100))
    XCTAssertEqual(crop, CGRect(x: 100, y: 0, width: 200, height: 200))
  }
  func testStackAndImpossiblePadding() throws {
    let stack = try WallpaperLayout.tiles(
      options(layout: "stack"), size: CGSize(width: 1440, height: 900), scale: 1,
      ratios: [1, 2, 0.5, 1, 1, 1, 1])
    XCTAssertEqual(stack.count, 6)
    XCTAssertEqual(stack[1].frame.height / stack[1].frame.width, 2, accuracy: 0.00001)
    let fill = try WallpaperLayout.tiles(
      options("fill", layout: "stack"), size: CGSize(width: 1440, height: 900), scale: 1,
      ratios: [1, 2, 1, 1])
    XCTAssertFalse(fill.contains(where: \.cover))
    XCTAssertThrowsError(
      try WallpaperLayout.tiles(
        options(), size: CGSize(width: 50, height: 50), scale: 1, ratios: [1, 1, 1, 1]))
    XCTAssertThrowsError(
      try WallpaperLayout.tiles(
        options(), size: CGSize(width: 1440, height: 900), scale: 1, ratios: [.infinity]))
  }
  func testCorruptImageAndRenderedPixelDimensions() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(
      UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let bad = root.appendingPathComponent("corrupt.jpg")
    try Data("not an image".utf8).write(to: bad)
    XCTAssertThrowsError(try WallpaperController.decode(bad))
    let context = CGContext(
      data: nil, width: 20, height: 10, bitsPerComponent: 8, bytesPerRow: 0,
      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    context.setFillColor(CGColor(red: 1, green: 0, blue: 0, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: 20, height: 10))
    let image = context.makeImage()!
    let png = try WallpaperController.render(
      options("fill"), images: [image, image, image, image], size: CGSize(width: 640, height: 480),
      scale: 1)
    let bitmap = NSBitmapImageRep(data: png)!
    XCTAssertEqual(bitmap.pixelsWide, 640)
    XCTAssertEqual(bitmap.pixelsHigh, 480)
    let valid = root.appendingPathComponent("valid.png")
    try png.write(to: valid)
    let decoded = try WallpaperController.decode(valid)
    XCTAssertEqual(decoded.width, 640)
    XCTAssertEqual(decoded.height, 480)
  }
  func testCleanupRetainsActiveAndPartialJobFiles() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(
      UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    for name in ["job-old", "job-active", "job-partial", "job-current"] {
      let directory = root.appendingPathComponent(name, isDirectory: true)
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      if name != "job-partial" {
        try Data().write(to: directory.appendingPathComponent(".success"))
      }
    }
    WallpaperController.cleanup(
      root: root, current: root.appendingPathComponent("job-current"),
      activeURLs: [root.appendingPathComponent("job-active/display-1.png")])
    XCTAssertFalse(
      FileManager.default.fileExists(atPath: root.appendingPathComponent("job-old").path))
    for name in ["job-active", "job-partial", "job-current"] {
      XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent(name).path))
    }
  }
  func testDailyPaletteUsesTheSameGregorianLocalDateAsThePreview() {
    let ny = TimeZone(identifier: "America/New_York")!
    let utc = TimeZone(secondsFromGMT: 0)!
    XCTAssertEqual(
      WallpaperController.localDayIndex(parseDate("1970-01-01T12:00:00Z")!, timeZone: ny), 0)
    XCTAssertEqual(
      WallpaperController.localDayIndex(parseDate("1970-01-01T00:00:00Z")!, timeZone: ny), -1)
    let date = parseDate("2026-07-13T12:00:00Z")!
    XCTAssertEqual(WallpaperController.localDayIndex(date, timeZone: ny), 20647)
    XCTAssertEqual(WallpaperController.localDayIndex(date, timeZone: utc), 20647)
    let midnight = parseDate("2026-07-13T01:00:00Z")!
    XCTAssertEqual(WallpaperController.localDayIndex(midnight, timeZone: ny), 20646)
    XCTAssertEqual(WallpaperController.localDayIndex(midnight, timeZone: utc), 20647)
  }

}
