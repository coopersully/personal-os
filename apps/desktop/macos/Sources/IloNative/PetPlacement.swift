import AppKit

struct PetSavedPlacement: Codable {
  var x: Double
  var y: Double
  var anchor: Int?
  var cardX: Double?
  var cardY: Double?
  var cardAnchor: Int?
  var width: Double = 400
  var height: Double = 560
}

/// Device-local geometry only. Dashboard/account material is never persisted here.
final class PetPlacementStore {
  private let defaults: UserDefaults
  private let key = "nohmi.pet.placements.v1"
  init(defaults: UserDefaults = .standard) { self.defaults = defaults }
  var activeDisplay: String? {
    get { defaults.string(forKey: "nohmi.pet.activeDisplay") }
    set { defaults.set(newValue, forKey: "nohmi.pet.activeDisplay") }
  }
  var pinned: Bool {
    get { defaults.bool(forKey: "nohmi.pet.pinned") }
    set { defaults.set(newValue, forKey: "nohmi.pet.pinned") }
  }
  func load(_ display: String) -> PetSavedPlacement? {
    guard let data = defaults.data(forKey: key),
      let values = try? JSONDecoder().decode([String: PetSavedPlacement].self, from: data)
    else { return nil }
    return values[display]
  }
  func save(_ value: PetSavedPlacement, display: String) {
    var values: [String: PetSavedPlacement] = [:]
    if let data = defaults.data(forKey: key) {
      values = (try? JSONDecoder().decode([String: PetSavedPlacement].self, from: data)) ?? [:]
    }
    values[display] = value
    if let data = try? JSONEncoder().encode(values) { defaults.set(data, forKey: key) }
    activeDisplay = display
  }
  // Hard-cutover migration from the shipped single-display position record.
  private let legacyKey = "ilo.pet.position"
  var legacyDisplay: String? {
    defaults.dictionary(forKey: legacyKey)?["display"] as? String
  }
  func migrateLegacy(display: String, visible: CGRect, geometry: PetGeometry, size: CGSize) {
    guard let legacy = defaults.dictionary(forKey: legacyKey) else { return }
    if load(display) == nil, activeDisplay == nil,
      let x = legacy["x"] as? Double, let y = legacy["y"] as? Double,
      x.isFinite, y.isFinite
    {
      let fitted = geometry.fit(
        CGRect(
          x: visible.minX + min(1, max(0, x)) * max(0, visible.width - 72),
          y: visible.minY + min(1, max(0, y)) * max(0, visible.height - 72),
          width: size.width, height: size.height))
      let bounds = geometry.bounds
      save(
        PetSavedPlacement(
          x: (fitted.minX - bounds.minX) / max(1, bounds.width - fitted.width),
          y: (fitted.minY - bounds.minY) / max(1, bounds.height - fitted.height),
          anchor: nil), display: display)
    }
    // Never remove the old value until a valid new record exists.
    if let activeDisplay, load(activeDisplay) != nil {
      defaults.removeObject(forKey: legacyKey)
    }
  }
  func reset() {
    defaults.removeObject(forKey: legacyKey)
    defaults.removeObject(forKey: key)
    activeDisplay = nil
  }
}

enum PetDisplays {
  static func id(_ screen: NSScreen) -> String {
    let number =
      (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value
      ?? 0
    if let uuid = CGDisplayCreateUUIDFromDisplayID(number)?.takeRetainedValue() {
      return CFUUIDCreateString(nil, uuid) as String
    }
    return String(number)
  }
  static func at(_ point: CGPoint) -> NSScreen? {
    NSScreen.screens.first(where: { $0.frame.contains(point) })
      ?? NSScreen.screens.min(by: {
        hypot($0.frame.midX - point.x, $0.frame.midY - point.y)
          < hypot($1.frame.midX - point.x, $1.frame.midY - point.y)
      })
  }
  static func geometry(_ screen: NSScreen) -> PetGeometry {
    // Metadata only: no screen pixels, titles, Accessibility, or recording permission.
    let windows =
      CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID)
      as? [[String: Any]] ?? []
    let top = NSScreen.screens.first?.frame.maxY ?? 0
    var obstacles = windows.compactMap { row -> CGRect? in
      guard row[kCGWindowOwnerName as String] as? String == "Dock",
        let raw = row[kCGWindowBounds as String] as? [String: CGFloat],
        let x = raw["X"], let y = raw["Y"], let w = raw["Width"], let h = raw["Height"]
      else { return nil }
      let frame = CGRect(x: x, y: top - y - h, width: w, height: h)
      guard frame.intersects(screen.frame), w > 40, h > 40,
        (w > 120 && h < screen.frame.height * 0.25 && abs(frame.minY - screen.frame.minY) < 16)
          || (h > 120 && w < screen.frame.width * 0.25
            && (abs(frame.minX - screen.frame.minX) < 16
              || abs(frame.maxX - screen.frame.maxX) < 16))
      else { return nil }
      return frame
    }
    if let measured = PetDock.shared.frame(),
      let dock = PetDock.resolve(measured, screen: screen.frame, desktopTop: top)
    {
      obstacles = [dock]
    }
    let hiddenDock = UserDefaults(suiteName: "com.apple.dock")?.bool(forKey: "autohide") == true
    return resolvedGeometry(
      frame: screen.frame, visible: screen.visibleFrame, dockFrames: obstacles,
      hiddenDock: hiddenDock)
  }
  static func resolvedGeometry(
    frame: CGRect, visible: CGRect, dockFrames: [CGRect], hiddenDock: Bool
  ) -> PetGeometry {
    var bounds = frame
    bounds.size.height -= max(0, frame.maxY - visible.maxY)
    var blocked = dockFrames
    if dockFrames.isEmpty && !hiddenDock {
      // Missing precise metadata is not evidence that compact corner lanes are clear.
      if visible.minY > frame.minY {
        blocked.append(
          CGRect(
            x: frame.minX, y: frame.minY, width: frame.width,
            height: visible.minY - frame.minY))
      }
      if visible.minX > frame.minX {
        blocked.append(
          CGRect(
            x: frame.minX, y: frame.minY,
            width: visible.minX - frame.minX, height: frame.height))
      }
      if visible.maxX < frame.maxX {
        blocked.append(
          CGRect(
            x: visible.maxX, y: frame.minY,
            width: frame.maxX - visible.maxX, height: frame.height))
      }
    }
    return PetGeometry(
      bounds: bounds,
      obstacles: blocked.sorted {
        if $0.minX != $1.minX { return $0.minX < $1.minX }
        if $0.minY != $1.minY { return $0.minY < $1.minY }
        if $0.width != $1.width { return $0.width < $1.width }
        return $0.height < $1.height
      },
      conservativeCardBounds: dockFrames.isEmpty && !hiddenDock ? visible : nil)
  }
}
