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

func makeRitualBackdrop(frame: NSRect, kind: String, reduceMotion: Bool, reduceTransparency: Bool) -> NSPanel {
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
 let sky = NSView(frame: view.bounds)
 sky.wantsLayer = true
 sky.autoresizingMask = [.width, .height]
 sky.layer?.backgroundColor = NSColor(srgbRed: night ? 0.035 : 0.15, green: night ? 0.07 : 0.31, blue: night ? 0.19 : 0.52, alpha: 1).cgColor
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
 let tint = NSColor(srgbRed: night ? 0.035 : 0.15, green: night ? 0.07 : 0.31, blue: night ? 0.19 : 0.52, alpha: reduceTransparency ? 1 : (night ? 0.52 : 0.24))
 // Keep the color/glow above AppKit's private visual-effect layers.
 let colorView = NSView(frame: view.bounds)
 colorView.autoresizingMask = [.width, .height]
 colorView.wantsLayer = true
 colorView.layer?.backgroundColor = tint.cgColor
 view.addSubview(colorView)
 let glow = CAGradientLayer()
 glow.type = .radial
 glow.frame = CGRect(x: -frame.width * 0.2, y: frame.height * (night ? 0.25 : -0.65), width: frame.width * 1.4, height: frame.height * 1.4)
 glow.startPoint = CGPoint(x: 0.5, y: 0.5)
 glow.endPoint = CGPoint(x: 1, y: 1)
 let light = night
  ? NSColor(srgbRed: 0.94, green: 0.97, blue: 1, alpha: 0.90)
  : NSColor(srgbRed: 1, green: 0.83, blue: 0.25, alpha: 0.95)
 glow.colors = [light.cgColor, light.withAlphaComponent(night ? 0.34 : 0.42).cgColor, light.withAlphaComponent(0).cgColor]
 glow.locations = [0, 0.35, 1]
 colorView.layer?.addSublayer(glow)
 if !reduceMotion {
  let rise = CABasicAnimation(keyPath: "transform.translation.y")
  rise.fromValue = frame.height * (night ? 0.55 : -0.55)
  rise.toValue = 0
  rise.duration = 3.6
  rise.timingFunction = CAMediaTimingFunction(name: .easeOut)
  glow.add(rise, forKey: "ritual-horizon-rise")
  let fade = CABasicAnimation(keyPath: "opacity")
  fade.fromValue = 0
  fade.toValue = 1
  fade.duration = 2.4
  fade.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
  glow.add(fade, forKey: "ritual-horizon-fade")
 }
 window.contentView = root
 window.setFrame(frame, display: true)
 return window
}

final class RitualBackdrop {
 static let shared = RitualBackdrop()
 private var windows: [NSWindow] = []
 private var appearance = ""
 private weak var checklist: NSWindow?
 private var introSound: NSSound?
 private var observers: [NSObjectProtocol] = []
 private(set) var locked = false
 init() {
  for name in ["com.apple.screenIsLocked", "com.apple.screenIsUnlocked"] {
   observers.append(DistributedNotificationCenter.default().addObserver(forName: NSNotification.Name(name), object: nil, queue: .main) { [weak self] notification in
    self?.locked = notification.name.rawValue == "com.apple.screenIsLocked"
    if self?.locked == true { self?.hide() }
    NativeCompanion.emit(["action": "ritual_refresh"])
   })
  }
  observers.append(NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.sessionDidResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
   self?.locked = true; self?.hide(); NativeCompanion.emit(["action": "ritual_refresh"])
  })
  observers.append(NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.sessionDidBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
   self?.locked = false; NativeCompanion.emit(["action": "ritual_refresh"])
  })
  for name in [NSWindow.didBecomeKeyNotification, NSApplication.didBecomeActiveNotification] {
   observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
    guard let self, !self.windows.isEmpty else { return }
    self.styleChecklist()
   })
  }
 }
 func hide(hideChecklist: Bool = true) {
  if hideChecklist { checklist?.orderOut(nil) }
  introSound?.stop()
  introSound = nil
  checklist = nil
  for window in windows {
   for child in window.childWindows ?? [] { window.removeChildWindow(child) }
   window.orderOut(nil)
  }
  windows = []; appearance = ""
 }
 @discardableResult
 func styleChecklist(windowAddress: UInt64? = nil, prepare: Bool = false, animate: Bool = false, kind: String = "morning") -> Bool {
  if let windowAddress {
   // Destroyed Tauri windows can linger in NSApp.windows with the same title.
   // Bind the exact current window, never an older snoozed presentation.
   checklist = NSApp.windows.first {
    UInt64(UInt(bitPattern: Unmanaged.passUnretained($0).toOpaque())) == windowAddress
   }
  }
  guard !locked, ritualSessionIsUnlocked(CGSessionCopyCurrentDictionary() as? [String: Any]), let window = checklist else {
   checklist?.orderOut(nil)
   return false
  }
  // A child window stays above its backdrop through activation and reordering.
  if let backdrop = windows.first(where: { $0.frame.intersects(window.frame) }), window.parent !== backdrop {
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
   window.orderFrontRegardless()
   introSound?.stop()
   let name = kind == "night" ? "ritual-night-intro" : "ritual-morning-intro"
   if let url = Bundle.main.url(forResource: name, withExtension: "wav", subdirectory: "sounds") {
    introSound = NSSound(contentsOf: url, byReference: true)
    introSound?.play()
   }
   // The web presentation sequences its own logo, card, and supporting text.
   // A second native fade/movement would compound that easing and clip the sequence.
   window.alphaValue = 1
  }
  return true
 }
 func fadeOut() -> Int {
  let duration = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? 0.0 : 0.65
  NSAnimationContext.runAnimationGroup { context in
   context.duration = duration
   context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
   for window in windows { window.animator().alphaValue = 0 }
  }
  return Int(duration * 1000)
 }
 func present(kind: String) -> Bool {
  guard !locked, ritualSessionIsUnlocked(CGSessionCopyCurrentDictionary() as? [String: Any]) else { hide(); return false }
  let reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
  let reduceTransparency = NSWorkspace.shared.accessibilityDisplayShouldReduceTransparency
  let next = "\(kind)|\(NSScreen.screens.map { String(describing: $0.frame) })|\(reduceMotion)|\(reduceTransparency)"
  if next == appearance && !windows.isEmpty {
   styleChecklist()
   return true
  }
  let currentChecklist = checklist
  hide(hideChecklist: false); appearance = next
  checklist = currentChecklist
  for screen in NSScreen.screens {
   let window = makeRitualBackdrop(frame: screen.frame, kind: kind, reduceMotion: reduceMotion, reduceTransparency: reduceTransparency)
   window.alphaValue = reduceMotion ? 1 : 0
   window.orderFrontRegardless()
   windows.append(window)
   if !reduceMotion {
    NSAnimationContext.runAnimationGroup { context in
     context.duration = 0.9
     context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
     window.animator().alphaValue = 1
    }
   }
  }
  styleChecklist()
  return true
 }
}
