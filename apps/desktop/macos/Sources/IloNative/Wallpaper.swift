import AppKit
import ImageIO

struct WallpaperOptions: Decodable {
  var backgroundColor: String
  var backgroundMode: String
  var cornerRadius: Double
  var frameSpacing: Double
  var layout: String
  var mosaicFit: String
  var paddingBottom: Double
  var paddingEnd: Double
  var paddingStart: Double
  var paddingTop: Double
  var tileSize: Double
  var rotationDegrees: Double
}
struct WallpaperTile {
  let index: Int
  let frame: CGRect  // top-left coordinates in physical pixels
  let angle: Double
  let cover: Bool
}
enum WallpaperLayout {
  static func tiles(_ options: WallpaperOptions, size: CGSize, scale: Double, ratios: [Double])
    throws -> [WallpaperTile]
  {
    guard size.width > 0, size.height > 0, scale > 0, scale.isFinite,
      !ratios.isEmpty, ratios.allSatisfy({ $0.isFinite && $0 > 0 })
    else { throw NativeError.message("Invalid wallpaper dimensions") }
    let left = options.paddingStart * scale
    let top = options.paddingTop * scale
    let width = size.width - left - options.paddingEnd * scale
    let height = size.height - top - options.paddingBottom * scale
    let gap = options.frameSpacing * scale
    guard width > 0, height > 0 else {
      throw NativeError.message("Wallpaper padding leaves no usable frame")
    }
    if options.layout == "stack" {
      let positions: [(Double, Double)] = [
        (0.03, 0.10), (0.39, 0.06), (0.17, 0.34), (0.51, 0.40), (0, 0.53), (0.33, 0.61),
      ]
      return ratios.prefix(6).enumerated().map { index, ratio in
        let cardWidth = width * (0.32 + options.tileSize * 0.0048)
        // Stack cards preserve their source ratio, matching the existing preview.
        // The mosaic fit setting applies to the grid layout.
        let drawWidth = cardWidth
        let drawHeight = drawWidth * ratio
        return WallpaperTile(
          index: index,
          frame: CGRect(
            x: left + width * positions[index].0, y: top + height * positions[index].1,
            width: drawWidth, height: drawHeight),
          angle: (index % 2 == 0 ? -1 : 1) * options.rotationDegrees, cover: false)
      }
    }
    let count = min(ratios.count, max(2, min(5, Int((7 - options.tileSize / 18).rounded()))))
    let columns = (0..<count).map { column in ratios.indices.filter { $0 % count == column } }
    let sums = columns.map { $0.reduce(0.0) { $0 + ratios[$1] } }
    let availableWidth = width - Double(count - 1) * gap
    guard availableWidth > 0 else {
      throw NativeError.message("Wallpaper spacing leaves no usable columns")
    }
    let sharedHeight = min(
      columns.map { height - Double($0.count - 1) * gap }.min() ?? height,
      availableWidth / sums.reduce(0.0) { $0 + 1 / $1 })
    guard sharedHeight > 0 else {
      throw NativeError.message("Wallpaper spacing leaves no usable rows")
    }
    let fill = options.mosaicFit == "fill"
    let widths = sums.map { fill ? availableWidth / Double(count) : sharedHeight / $0 }
    let gridWidth = widths.reduce(0, +) + Double(count - 1) * gap
    var x = left + (fill ? 0 : (width - gridWidth) / 2)
    var tiles: [WallpaperTile] = []
    for (columnIndex, indices) in columns.enumerated() {
      let w = widths[columnIndex]
      let columnHeight = w * sums[columnIndex] + Double(indices.count - 1) * gap
      var y = top + (fill ? 0 : (height - columnHeight) / 2)
      for (row, index) in indices.enumerated() {
        let h =
          fill
          ? (height - Double(indices.count - 1) * gap) / Double(indices.count) : w * ratios[index]
        tiles.append(
          WallpaperTile(
            index: index, frame: CGRect(x: x, y: y, width: w, height: h),
            angle: (row + columnIndex) % 2 == 0
              ? -options.rotationDegrees * 0.15 : options.rotationDegrees * 0.15, cover: fill))
        y += h + gap
      }
      x += w + gap
    }
    return tiles
  }
  static func crop(source: CGSize, target: CGSize) -> CGRect {
    let scale = max(target.width / source.width, target.height / source.height)
    let width = target.width / scale
    let height = target.height / scale
    return CGRect(
      x: (source.width - width) / 2, y: (source.height - height) / 2, width: width, height: height)
  }
}

enum WallpaperController {
  static let maximumImageBytes = 12 * 1024 * 1024
  static let maximumImagePixels = 32_000_000
  static let maximumTotalPixels = 64_000_000
  static func decode(_ url: URL) throws -> CGImage {
    let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
    guard let bytes = attributes[.size] as? NSNumber, bytes.intValue > 0,
      bytes.intValue <= maximumImageBytes,
      let source = CGImageSourceCreateWithURL(
        url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
      let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
      let width = properties[kCGImagePropertyPixelWidth] as? Int,
      let height = properties[kCGImagePropertyPixelHeight] as? Int,
      width > 0, height > 0, width <= 8192, height <= 8192, width * height <= maximumImagePixels
    else {
      throw NativeError.message("A Pinterest image is corrupt or exceeds the 8192px / 32MP limit")
    }
    // Respect EXIF orientation and cap decoded memory; dimensions are checked before decoding.
    guard
      let image = CGImageSourceCreateThumbnailAtIndex(
        source, 0,
        [
          kCGImageSourceCreateThumbnailFromImageAlways: true,
          kCGImageSourceCreateThumbnailWithTransform: true,
          kCGImageSourceThumbnailMaxPixelSize: 4096,
          kCGImageSourceShouldCacheImmediately: true,
        ] as CFDictionary)
    else { throw NativeError.message("Could not decode a Pinterest image") }
    return image
  }
  static func color(_ hex: String) -> NSColor {
    let value = UInt32(hex.dropFirst(), radix: 16) ?? 0xffffff
    return NSColor(
      srgbRed: Double((value >> 16) & 255) / 255, green: Double((value >> 8) & 255) / 255,
      blue: Double(value & 255) / 255, alpha: 1)
  }
  static func localDayIndex(_ date: Date, timeZone: TimeZone) -> Int {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    let epoch = calendar.date(from: DateComponents(year: 1970, month: 1, day: 1))!
    return calendar.dateComponents([.day], from: epoch, to: calendar.startOfDay(for: date)).day!
  }
  static func backdrop(_ options: WallpaperOptions, images: [CGImage]) -> NSColor {
    if options.backgroundMode == "custom" { return color(options.backgroundColor) }
    if options.backgroundMode == "random" {
      let palette = ["#DCE8F2", "#E9DFD0", "#DCE9DC", "#EEE0EA", "#F0E5D3", "#E1E2F1"]
      let day = localDayIndex(Date(), timeZone: .current)
      return color(palette[((day % palette.count) + palette.count) % palette.count])
    }
    if options.backgroundMode == "matched" {
      var totals = [Double](repeating: 0, count: 3)
      for image in images {
        var pixels = [UInt8](repeating: 0, count: 8 * 8 * 4)
        pixels.withUnsafeMutableBytes { buffer in
          guard
            let context = CGContext(
              data: buffer.baseAddress, width: 8, height: 8, bitsPerComponent: 8, bytesPerRow: 32,
              space: CGColorSpaceCreateDeviceRGB(),
              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
          else { return }
          context.setFillColor(CGColor(gray: 1, alpha: 1))
          context.fill(CGRect(x: 0, y: 0, width: 8, height: 8))
          context.draw(image, in: CGRect(x: 0, y: 0, width: 8, height: 8))
        }
        for offset in stride(from: 0, to: pixels.count, by: 4) {
          for channel in 0..<3 { totals[channel] += Double(pixels[offset + channel]) / 255 }
        }
      }
      let divisor = Double(images.count * 64)
      return NSColor(
        srgbRed: totals[0] / divisor * 0.38 + 0.62, green: totals[1] / divisor * 0.38 + 0.62,
        blue: totals[2] / divisor * 0.38 + 0.62, alpha: 1)
    }
    return .white
  }
  static func render(_ options: WallpaperOptions, images: [CGImage], size: CGSize, scale: Double)
    throws -> Data
  {
    guard size.width > 0, size.height > 0, size.width <= 16384, size.height <= 16384,
      size.width * size.height <= 64_000_000,
      let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: Int(size.width), pixelsHigh: Int(size.height),
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
      let context = NSGraphicsContext(bitmapImageRep: bitmap)
    else { throw NativeError.message("Display dimensions exceed the 64MP wallpaper limit") }
    let tiles = try WallpaperLayout.tiles(
      options, size: size, scale: scale, ratios: images.map { Double($0.height) / Double($0.width) }
    )
    NSGraphicsContext.saveGraphicsState()
    defer { NSGraphicsContext.restoreGraphicsState() }
    NSGraphicsContext.current = context
    backdrop(options, images: images).setFill()
    NSBezierPath(rect: CGRect(origin: .zero, size: size)).fill()
    for tile in tiles {
      let cgImage = images[tile.index]
      let source = CGSize(width: cgImage.width, height: cgImage.height)
      let image = NSImage(cgImage: cgImage, size: source)
      var frame = tile.frame
      frame.origin.y = size.height - frame.maxY
      NSGraphicsContext.saveGraphicsState()
      let affine = NSAffineTransform()
      affine.translateX(by: frame.midX, yBy: frame.midY)
      affine.rotate(byDegrees: CGFloat(-tile.angle))
      affine.translateX(by: -frame.midX, yBy: -frame.midY)
      affine.concat()
      let radius = min(options.cornerRadius * scale, frame.width / 2, frame.height / 2)
      NSBezierPath(roundedRect: frame, xRadius: radius, yRadius: radius).addClip()
      let crop =
        tile.cover
        ? WallpaperLayout.crop(source: source, target: frame.size)
        : CGRect(origin: .zero, size: source)
      image.draw(in: frame, from: crop, operation: .sourceOver, fraction: 1)
      NSGraphicsContext.restoreGraphicsState()
    }
    guard let png = bitmap.representation(using: .png, properties: [:]) else {
      throw NativeError.message("Could not encode wallpaper")
    }
    return png
  }
  static func screenID(_ screen: NSScreen) -> String? {
    (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.stringValue
  }
  static func prepare(_ object: [String: Any]) throws -> [String: Any] {
    guard let raw = object["request"], let paths = object["imagePaths"] as? [String],
      (4...20).contains(paths.count), let directory = object["outputDirectory"] as? String,
      !NSScreen.screens.isEmpty
    else { throw NativeError.message("Missing wallpaper images or displays") }
    let options = try JSONDecoder().decode(
      WallpaperOptions.self, from: JSONSerialization.data(withJSONObject: raw))
    var unique: [String: CGImage] = [:]
    var totalPixels = 0
    for path in paths where unique[path] == nil {
      let image = try decode(URL(fileURLWithPath: path))
      totalPixels += image.width * image.height
      guard totalPixels <= maximumTotalPixels else {
        throw NativeError.message("Selected images exceed the 64MP decoded-memory limit")
      }
      unique[path] = image
    }
    let images = paths.compactMap { unique[$0] }
    guard images.count == paths.count else {
      throw NativeError.message("Not enough usable Pinterest images")
    }
    let output = URL(fileURLWithPath: directory, isDirectory: true)
    // Prepare every display before changing any current desktop image.
    for screen in NSScreen.screens {
      guard let id = screenID(screen), let displayID = UInt32(id) else {
        throw NativeError.message("Display identity unavailable")
      }
      guard let mode = CGDisplayCopyDisplayMode(displayID) else {
        throw NativeError.message("Display dimensions unavailable")
      }
      let size = CGSize(width: mode.pixelWidth, height: mode.pixelHeight)
      let png = try render(options, images: images, size: size, scale: screen.backingScaleFactor)
      try png.write(to: output.appendingPathComponent("display-\(id).png"), options: .atomic)
    }
    for path in Set(paths) { try? FileManager.default.removeItem(atPath: path) }
    return ["ok": true]
  }
  static func apply(_ object: [String: Any]) throws -> [String: Any] {
    guard let directory = object["outputDirectory"] as? String, !NSScreen.screens.isEmpty else {
      throw NativeError.message("Missing wallpaper output or displays")
    }
    let output = URL(fileURLWithPath: directory, isDirectory: true)
    let screens = NSScreen.screens
    let targets = try screens.map { screen -> URL in
      guard let id = screenID(screen) else {
        throw NativeError.message("Display identity unavailable")
      }
      let target = output.appendingPathComponent("display-\(id).png")
      guard FileManager.default.fileExists(atPath: target.path) else {
        throw NativeError.message("Displays changed during wallpaper preparation. Retry.")
      }
      return target
    }
    let manifestURL = output.deletingLastPathComponent().appendingPathComponent(
      "active-displays.json")
    let manifestExists = FileManager.default.fileExists(atPath: manifestURL.path)
    let previousManifest = (try? Data(contentsOf: manifestURL)).flatMap {
      try? JSONDecoder().decode([String: String].self, from: $0)
    }
    // Remember disconnected displays too. If the record is unreadable, skip cleanup entirely.
    var activePaths = previousManifest ?? [:]
    // Mark before the first OS mutation so Rust can distinguish cancellation from partial application.
    try Data().write(to: output.appendingPathComponent(".apply-started"), options: .atomic)
    var failures: [String] = []
    var applied = 0
    for (screen, target) in zip(screens, targets) {
      do {
        try NSWorkspace.shared.setDesktopImageURL(target, for: screen, options: [:])
        applied += 1
        if let id = screenID(screen) { activePaths[id] = target.path }
      } catch { failures.append("\(screen.localizedName): \(error.localizedDescription)") }
    }
    var canCleanup = !manifestExists || previousManifest != nil
    do { try JSONEncoder().encode(activePaths).write(to: manifestURL, options: .atomic) } catch {
      canCleanup = false
    }
    guard failures.isEmpty else {
      throw NativeError.message(
        "Wallpaper applied to \(applied) of \(screens.count) displays. "
          + failures.joined(separator: "; "))
    }
    try? Data().write(to: output.appendingPathComponent(".success"), options: .atomic)
    if canCleanup {
      let connected = screens.compactMap { NSWorkspace.shared.desktopImageURL(for: $0) }
      cleanup(
        root: output.deletingLastPathComponent(), current: output,
        activeURLs: connected + activePaths.values.map { URL(fileURLWithPath: $0) })
    }
    return ["ok": true, "path": targets[0].path, "appliedDisplays": applied]
  }
  static func cleanup(root: URL, current: URL, activeURLs: [URL]) {
    guard
      let entries = try? FileManager.default.contentsOfDirectory(
        at: root, includingPropertiesForKeys: nil)
    else { return }
    let retained = Set(activeURLs.map { $0.deletingLastPathComponent().standardizedFileURL.path })
    for entry in entries
    where entry.lastPathComponent.hasPrefix("job-")
      && entry.standardizedFileURL != current.standardizedFileURL
    {
      guard !retained.contains(entry.standardizedFileURL.path),
        FileManager.default.fileExists(atPath: entry.appendingPathComponent(".success").path)
      else { continue }
      try? FileManager.default.removeItem(at: entry)
    }
  }
}
