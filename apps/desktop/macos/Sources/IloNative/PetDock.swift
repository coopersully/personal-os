import AppKit
import ApplicationServices
import QuartzCore

/// Reads only the Dock's accessibility geometry. Never inspects other applications,
/// captures pixels, or performs accessibility actions. Slow IPC stays off the render thread.
final class PetDock {
  static let shared = PetDock()
  private let queue = DispatchQueue(label: "nohmi.pet.dock", qos: .utility)
  private var inFlight = false
  private var sampledAt: Double = 0
  private var measured: CGRect?
  static var authorized: Bool { AXIsProcessTrusted() }

  static func requestAccess() throws {
    _ = AXIsProcessTrustedWithOptions(
      [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
    guard let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"),
      NSWorkspace.shared.open(url)
    else { throw NativeError.message("Could not open Accessibility settings. Open System Settings to enable nohmi.") }
  }

  // Called on the main thread; cache expires rather than keeping stale Dock geometry.
  func frame() -> CGRect? {
    guard Self.authorized else { measured = nil; return nil }
    let now = CACurrentMediaTime()
    if !inFlight && now - sampledAt >= 1,
      let pid = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.dock")
        .first?.processIdentifier
    {
      inFlight = true
      queue.async { [weak self] in
        let result = Self.read(pid: pid)
        DispatchQueue.main.async {
          guard let self else { return }
          self.measured = result
          self.sampledAt = CACurrentMediaTime()
          self.inFlight = false
        }
      }
    }
    return now - sampledAt < 3 ? measured : nil
  }

  private static func read(pid: pid_t) -> CGRect? {
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, 0.05)
    let deadline = CACurrentMediaTime() + 0.25
    func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
      guard CACurrentMediaTime() < deadline else { return nil }
      var value: CFTypeRef?
      return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
    }
    guard let children = attribute(app, kAXChildrenAttribute) as? [AXUIElement] else { return nil }
    // The Dock exposes its visible container as AXList, not the full-screen CG window.
    for child in children.prefix(16) {
      guard attribute(child, kAXRoleAttribute) as? String == kAXListRole,
        let position = attribute(child, kAXPositionAttribute),
        let size = attribute(child, kAXSizeAttribute),
        CFGetTypeID(position) == AXValueGetTypeID(), CFGetTypeID(size) == AXValueGetTypeID()
      else { continue }
      var point = CGPoint.zero
      var dimensions = CGSize.zero
      guard AXValueGetValue(position as! AXValue, .cgPoint, &point),
        AXValueGetValue(size as! AXValue, .cgSize, &dimensions)
      else { continue }
      let rect = CGRect(origin: point, size: dimensions)
      if !rect.isEmpty && !rect.isInfinite && !rect.isNull { return rect }
    }
    return nil
  }

  static func resolve(_ rect: CGRect, screen: CGRect, desktopTop: CGFloat) -> CGRect? {
    let frame = CGRect(x: rect.minX, y: desktopTop - rect.maxY, width: rect.width, height: rect.height)
    guard frame.intersects(screen), frame.width > 0, frame.height > 0,
      (frame.width > 120 && frame.height < screen.height * 0.25
        && abs(frame.minY - screen.minY) < 24)
        || (frame.height > 120 && frame.width < screen.width * 0.25
          && (abs(frame.minX - screen.minX) < 24 || abs(frame.maxX - screen.maxX) < 24))
    else { return nil }
    return frame.intersection(screen)
  }
}
