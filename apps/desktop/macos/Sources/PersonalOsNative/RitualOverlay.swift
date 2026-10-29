import AppKit
import Foundation
import QuartzCore

func ritualDate(_ value: Any?) -> Date? {
 guard let string=value as? String else { return nil }
 let formatter=ISO8601DateFormatter();formatter.formatOptions=[.withInternetDateTime,.withFractionalSeconds]
 if let date=formatter.date(from:string) {return date}
 formatter.formatOptions=[.withInternetDateTime];return formatter.date(from:string)
}
func ritualShouldPresent(_ current:[String:Any],now:Date,locked:Bool)->Bool {
 guard !locked,current["status"] as? String == "pending",let due=ritualDate(current["dueAt"]),let expiry=ritualDate(current["expiresAt"]),due<=now,now<expiry else {return false}
 if let snooze=ritualDate(current["snoozedUntil"]),now<snooze {return false}
 return true
}
// macOS omits CGSSessionScreenIsLocked in a normal unlocked console session.
// Require the positive public session flags; nil/partial dictionaries and malformed
// lock values are unavailable, never permission to display private content.
func ritualSessionIsUnlocked(_ session: [String: Any]?) -> Bool {
 guard let session,
       session[kCGSessionOnConsoleKey as String] as? Bool == true,
       session[kCGSessionLoginDoneKey as String] as? Bool == true else { return false }
 if let value = session["CGSSessionScreenIsLocked"] {
  guard let locked = value as? Bool else { return false }
  return !locked
 }
 return true
}
// These views intentionally consume pointer events while leaving system shortcuts available.
private final class RitualBlockingView: NSVisualEffectView {
 override func hitTest(_ point: NSPoint) -> NSView? { bounds.contains(point) ? self : nil }
 override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
 override func mouseDown(with event: NSEvent) {}
 override func mouseUp(with event: NSEvent) {}
 override func rightMouseDown(with event: NSEvent) {}
 override func otherMouseDown(with event: NSEvent) {}
 override func scrollWheel(with event: NSEvent) {}
}
private final class RitualBlockingPanel: NSPanel {
 override var canBecomeKey: Bool { false }
 override var canBecomeMain: Bool { false }
}
let ritualChecklistLevel = NSWindow.Level(rawValue: NSWindow.Level.modalPanel.rawValue + 1)

struct RitualDisplay: Equatable {
 let id: UInt32
 let frame: NSRect
 let scale: CGFloat
}

// AppKit lists the menu-bar/primary display first, independently of the key window.
func ritualConnectedDisplays() -> [RitualDisplay] {
 NSScreen.screens.compactMap { screen in
  guard let id = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else { return nil }
  return RitualDisplay(id: id.uint32Value, frame: screen.frame, scale: screen.backingScaleFactor)
 }
}

private let ritualSkyImageID = NSUserInterfaceItemIdentifier("ritual-sky-image")
private let ritualSecondaryMessageID = NSUserInterfaceItemIdentifier("ritual-secondary-message")
func makeRitualBackdrop(frame: NSRect, kind: String, reduceMotion: Bool, reduceTransparency: Bool, secondary: Bool = false) -> NSPanel {
 let window = RitualBlockingPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
 window.level = .modalPanel
 window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
 window.isOpaque = false
 window.backgroundColor = .clear
 window.hasShadow = false
 window.ignoresMouseEvents = false
 let view = RitualBlockingView(frame: NSRect(origin: .zero, size: frame.size))
 view.material = .fullScreenUI
 view.blendingMode = .withinWindow
 view.state = .active
 view.wantsLayer = true
 let night = kind == "night"
 let root = NSView(frame: view.bounds)
 root.autoresizingMask = [.width, .height]
 let sky = NSView(frame: view.bounds)
 sky.wantsLayer = true
 sky.autoresizingMask = [.width, .height]
 sky.layer?.backgroundColor = NSColor(srgbRed: night ? 16.0/255 : 135.0/255, green: night ? 22.0/255 : 206.0/255, blue: night ? 34.0/255 : 250.0/255, alpha: 1).cgColor
 root.addSubview(sky)
 view.autoresizingMask = [.width, .height]
 root.addSubview(view)
 if !reduceMotion {
  let skyFade = CABasicAnimation(keyPath: "opacity")
  skyFade.fromValue = 0
  skyFade.toValue = 1
  skyFade.duration = 1.8
  skyFade.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
  sky.layer?.add(skyFade, forKey: "ritual-sky-fade")
 }
 let tint = NSColor(srgbRed: night ? 16.0/255 : 135.0/255, green: night ? 22.0/255 : 206.0/255, blue: night ? 34.0/255 : 250.0/255, alpha: reduceTransparency ? 1 : (night ? 0.52 : 0.24))
 // Keep the solid sky color above AppKit's private visual-effect layers.
 let colorView = NSView(frame: view.bounds)
 colorView.autoresizingMask = [.width, .height]
 colorView.wantsLayer = true
 colorView.layer?.backgroundColor = tint.cgColor
 view.addSubview(colorView)
 let image = NSImageView(frame: view.bounds)
 image.identifier = ritualSkyImageID
 image.autoresizingMask = [.width, .height]
 image.imageScaling = .scaleAxesIndependently
 image.isHidden = !secondary
 image.setAccessibilityElement(false)
 view.addSubview(image)
 let message = NSTextField(wrappingLabelWithString: "continue on your main display")
 message.identifier = ritualSecondaryMessageID
 message.font = .systemFont(ofSize: 18, weight: .medium)
 message.textColor = night ? .white : NSColor(srgbRed: 0.12, green: 0.18, blue: 0.23, alpha: 1)
 message.alignment = .center
 message.isSelectable = false
 message.isHidden = !secondary
 message.translatesAutoresizingMaskIntoConstraints = false
 view.addSubview(message)
 NSLayoutConstraint.activate([
  message.centerXAnchor.constraint(equalTo: view.centerXAnchor),
  message.centerYAnchor.constraint(equalTo: view.centerYAnchor),
  message.widthAnchor.constraint(lessThanOrEqualTo: view.widthAnchor, constant: -64),
 ])
 window.isReleasedWhenClosed = false
 window.contentView = root
 window.setFrame(frame, display: true)
 return window
}

final class RitualBackdrop {
 static let shared = RitualBackdrop()
 private(set) var windows: [NSWindow] = []
 private var panels: [UInt32: NSWindow] = [:]
 private var appearance = ""
 private var layout: [RitualDisplay] = []
 private var activeKind: String?
 private var fading = false
 private var reconciling = false
 private weak var checklist: NSWindow?
 private var introSound: NSSound?
 private var skyImage: NSImage?
 private var skyIsDark = false
 private var removeObservers: [() -> Void] = []
 private let displays: () -> [RitualDisplay]
 private let sessionUnlocked: () -> Bool
 private let orderFront: (NSWindow) -> Void
 private(set) var locked = false

 init(displays: @escaping () -> [RitualDisplay] = ritualConnectedDisplays,
      sessionUnlocked: @escaping () -> Bool = { ritualSessionIsUnlocked(CGSessionCopyCurrentDictionary() as? [String: Any]) },
      orderFront: @escaping (NSWindow) -> Void = { $0.orderFrontRegardless() },
      notifications: NotificationCenter = .default) {
  self.displays = displays
  self.sessionUnlocked = sessionUnlocked
  self.orderFront = orderFront
  for name in ["com.apple.screenIsLocked", "com.apple.screenIsUnlocked"] {
   observe(DistributedNotificationCenter.default(), name: NSNotification.Name(name)) { [weak self] notification in
    self?.locked = notification.name.rawValue == "com.apple.screenIsLocked"
    if self?.locked == true { self?.hide() }
    NativeCompanion.emit(["action": "ritual_refresh"])
   }
  }
  observe(NSWorkspace.shared.notificationCenter, name: NSWorkspace.sessionDidResignActiveNotification) { [weak self] _ in
   self?.locked = true; self?.hide(); NativeCompanion.emit(["action": "ritual_refresh"])
  }
  observe(NSWorkspace.shared.notificationCenter, name: NSWorkspace.sessionDidBecomeActiveNotification) { [weak self] _ in
   self?.locked = false; NativeCompanion.emit(["action": "ritual_refresh"])
  }
  for name in [NSWindow.didBecomeKeyNotification, NSApplication.didBecomeActiveNotification] {
   observe(notifications, name: name) { [weak self] _ in
    guard let self, !self.windows.isEmpty, !self.reconciling, !self.fading else { return }
    if !self.styleChecklist() { self.hide(); NativeCompanion.emit(["action": "ritual_refresh"]) }
   }
  }
  observe(notifications, name: NSApplication.didChangeScreenParametersNotification) { [weak self] _ in
   self?.reconcileDisplays()
  }
  // Backing scale changes and OS-driven moves/resizes may arrive before the display notification.
  for name in [NSWindow.didChangeScreenNotification, NSWindow.didChangeBackingPropertiesNotification,
               NSWindow.didResizeNotification, NSWindow.didMoveNotification] {
   observe(notifications, name: name) { [weak self] notification in
    guard let self, let window = notification.object as? NSWindow, window === self.checklist else { return }
    self.reconcileDisplays()
   }
  }
 }
 private func observe(_ centre: NotificationCenter, name: Notification.Name,
                      using block: @escaping (Notification) -> Void) {
  let token = centre.addObserver(forName: name, object: nil, queue: .main, using: block)
  removeObservers.append { centre.removeObserver(token) }
 }
 deinit { for remove in removeObservers { remove() } }

 private func reconcileDisplays() {
  guard !reconciling, !fading, let kind = activeKind else { return }
  if !present(kind: kind) { NativeCompanion.emit(["action": "ritual_refresh"]) }
 }
 func hide() {
  activeKind = nil; fading = false
  skyImage = nil; skyIsDark = false
  checklist?.orderOut(nil)
  introSound?.stop(); introSound = nil
  if let checklist { checklist.parent?.removeChildWindow(checklist) }
  checklist = nil
  for window in windows { window.orderOut(nil); window.close() }
  windows = []; panels = [:]; layout = []; appearance = ""
 }
 @discardableResult
 func styleChecklist(windowAddress: UInt64? = nil, prepare: Bool = false, animate: Bool = false, kind: String = "morning") -> Bool {
  if let windowAddress {
   // Bind the exact current Tauri window; do not choose an older snoozed presentation.
   checklist = NSApp.windows.first {
    UInt64(UInt(bitPattern: Unmanaged.passUnretained($0).toOpaque())) == windowAddress
   }
  }
  guard !locked, sessionUnlocked(), let window = checklist, let primary = displays().first else {
   hide()
   return false
  }
  let wasReconciling = reconciling
  reconciling = true
  defer { reconciling = wasReconciling }
  // Use AppKit points, including negative monitor origins. No Retina multiplication,
  // visibleFrame inset, or native fullscreen Space: the same webview keeps its drafts.
  if window.frame != primary.frame {
   window.parent?.removeChildWindow(window)
   window.setFrame(primary.frame, display: true)
  }
  if let backdrop = panels[primary.id], window.parent !== backdrop {
   window.parent?.removeChildWindow(window)
   backdrop.addChildWindow(window, ordered: .above)
  }
  window.level = ritualChecklistLevel
  window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
  window.isOpaque = false
  window.backgroundColor = .clear
  window.hasShadow = false
  window.contentView?.wantsLayer = true
  window.contentView?.layer?.cornerRadius = 0
  window.contentView?.layer?.masksToBounds = false
  if prepare { window.alphaValue = 0 }
  if animate {
   orderFront(window)
   introSound?.stop()
   let name = kind == "night" ? "ritual-night-intro" : "ritual-morning-intro"
   if let url = Bundle.main.url(forResource: name, withExtension: "wav", subdirectory: "sounds") {
    introSound = NSSound(contentsOf: url, byReference: true)
    introSound?.play()
   }
   window.alphaValue = 1
  }
  return true
 }
 func fadeOut() -> Int {
  fading = true
  let duration = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? 0.0 : 0.65
  NSAnimationContext.runAnimationGroup { context in
   context.duration = duration
   context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
   for window in windows { window.animator().alphaValue = 0 }
  }
  return Int(duration * 1000)
 }
 func present(kind: String) -> Bool {
  guard !reconciling else { return true }
  guard !locked, sessionUnlocked(), checklist != nil else { hide(); return false }
  let connected = displays()
  guard let primary = connected.first else { hide(); return false }
  reconciling = true
  defer { reconciling = false }
  activeKind = kind
  let reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
  let reduceTransparency = NSWorkspace.shared.accessibilityDisplayShouldReduceTransparency
  let nextAppearance = "\(kind)|\(reduceMotion)|\(reduceTransparency)"
  if nextAppearance == appearance && connected == layout && !windows.isEmpty {
   guard styleChecklist() else { hide(); return false }
   return true
  }
  let replace = appearance != nextAppearance
  let ids = Set(connected.map { $0.id })
  // Detach before moving a parent: AppKit otherwise translates its child by the same offset.
  if let checklist { checklist.parent?.removeChildWindow(checklist) }
  for (id, panel) in Array(panels) where !ids.contains(id) || replace {
   panel.orderOut(nil); panel.close(); panels.removeValue(forKey: id)
  }
  for display in connected {
   let panel: NSWindow
   if let existing = panels[display.id] {
    panel = existing
    if panel.frame != display.frame { panel.setFrame(display.frame, display: true) }
   } else {
    panel = makeRitualBackdrop(frame: display.frame, kind: kind, reduceMotion: reduceMotion,
                               reduceTransparency: reduceTransparency, secondary: display.id != primary.id)
    panels[display.id] = panel
   }
   setSecondaryMessage(in: panel.contentView, visible: display.id != primary.id)
   applySky(in: panel.contentView, secondary: display.id != primary.id)
   // Do not fade/replay sound or rebuild the webview on topology changes.
   panel.alphaValue = 1
   orderFront(panel)
  }
  windows = connected.compactMap { panels[$0.id] }
  appearance = nextAppearance
  layout = connected
  guard styleChecklist() else { hide(); return false }
  return true
 }
 // RGBA is generated from our decorative canvas, never the desktop or private UI.
 @discardableResult
 func updateSky(width: Int, height: Int, pixels: String, dark: Bool = false) -> Bool {
  guard !locked, !fading, activeKind != nil, checklist != nil, sessionUnlocked(),
        (1...400).contains(width), (1...240).contains(height), pixels.utf8.count <= 512000,
        let bytes = Data(base64Encoded: pixels), bytes.count == width * height * 4,
        let provider = CGDataProvider(data: bytes as CFData),
        let cgImage = CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32,
                              bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
                              bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.last.rawValue),
                              provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent)
  else { return false }
  skyImage = NSImage(cgImage: cgImage, size: NSSize(width: width, height: height))
  skyIsDark = dark
  let primary = layout.first?.id
  for (id, window) in panels { applySky(in: window.contentView, secondary: id != primary) }
  return true
 }
 private func applySky(in view: NSView?, secondary: Bool) {
  guard let view else { return }
  if view.identifier == ritualSecondaryMessageID, let message = view as? NSTextField, skyImage != nil {
   message.textColor = skyIsDark ? .white : NSColor(srgbRed: 0.12, green: 0.18, blue: 0.23, alpha: 1)
  }
  if view.identifier == ritualSkyImageID, let image = view as? NSImageView {
   image.image = skyImage
   image.isHidden = !secondary || skyImage == nil
   return
  }
  for child in view.subviews { applySky(in: child, secondary: secondary) }
 }
 private func setSecondaryMessage(in view: NSView?, visible: Bool) {
  guard let view else { return }
  if view.identifier == ritualSecondaryMessageID { view.isHidden = !visible; return }
  for child in view.subviews { setSecondaryMessage(in: child, visible: visible) }
 }
}
