import AppKit
import QuartzCore

final class PetPanel: NSPanel {
  var acceptsKeyboard = false
  override var canBecomeKey: Bool { acceptsKeyboard }
  override var canBecomeMain: Bool { false }
}
final class PetView: NSView {
  var visibleAccessibilityFrame = CGRect.zero
  override func accessibilityFrame() -> NSRect { visibleAccessibilityFrame }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  var contextAction: ((String) -> Void)?
  var click: (() -> Void)?
  var moved: (() -> Void)?
  var dragStart: (() -> Void)?
  var dragChange: (() -> Void)?
  var hoverChange: ((Bool) -> Void)?
  var color = NSColor.systemTeal { didSet { needsDisplay = true } }
  private var origin: NSPoint?
  private var dragged = false
  private var hovering = false
  private var displayClock: CADisplayLink?
  private var hoverAmount: CGFloat = 0
  private var acknowledgedAt: Double?
  func acknowledgeCompletion() {
    acknowledgedAt = CACurrentMediaTime()
    needsDisplay = true
  }
  private var lastFrame = CACurrentMediaTime()
  var animationActive = false {
    didSet {
      if oldValue != animationActive { animationActive ? restartAnimation() : stopAnimation() }
    }
  }
  var peeking = false { didSet { if oldValue != peeking { needsDisplay = true } } }
  var peekOcclusion: CGFloat = 32 {
    didSet { if oldValue != peekOcclusion { needsDisplay = true } }
  }
  var transitionScale: CGFloat = 1 {
    didSet { if oldValue != transitionScale { needsDisplay = true } }
  }
  override init(frame: NSRect) {
    super.init(frame: frame)
    setAccessibilityElement(true)
    setAccessibilityRole(.button)
    setAccessibilityLabel("nohmi desktop pet. Open quick access")
    NSWorkspace.shared.notificationCenter.addObserver(
      self, selector: #selector(restartAnimation),
      name: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil)
    NSWorkspace.shared.notificationCenter.addObserver(
      self, selector: #selector(stopAnimation), name: NSWorkspace.willSleepNotification, object: nil
    )
    NSWorkspace.shared.notificationCenter.addObserver(
      self, selector: #selector(restartAnimation), name: NSWorkspace.didWakeNotification,
      object: nil)
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  deinit {
    displayClock?.invalidate()
    NotificationCenter.default.removeObserver(self)
    NSWorkspace.shared.notificationCenter.removeObserver(self)
  }
  override func viewDidMoveToWindow() { restartAnimation() }
  @objc func stopAnimation() {
    displayClock?.invalidate()
    displayClock = nil
  }
  @objc func restartAnimation() {
    stopAnimation()
    guard animationActive, window != nil, !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    else {
      needsDisplay = true
      return
    }
    let clock = displayLink(target: self, selector: #selector(animateFrame(_:)))
    clock.preferredFrameRateRange = CAFrameRateRange(minimum: 30, maximum: 60, preferred: 60)
    lastFrame = CACurrentMediaTime()
    clock.add(to: .main, forMode: .common)
    displayClock = clock
  }
  @objc private func animateFrame(_ clock: CADisplayLink) {
    guard window?.isVisible == true else { return }
    let now = CACurrentMediaTime()
    let dt = min(0.1, now - lastFrame)
    lastFrame = now
    let target: CGFloat = hovering && !peeking ? 1 : 0
    let previousHover = hoverAmount
    hoverAmount += (target - hoverAmount) * CGFloat(1 - exp(-dt * 18))
    // A settled peek has no breathing motion; repaint only its blink/acknowledgment.
    let phase = now.truncatingRemainder(dividingBy: 5.6)
    if !peeking || abs(hoverAmount - previousHover) > 0.001 || phase < 0.3
      || (acknowledgedAt.map { now - $0 < 0.5 } ?? false)
    {
      needsDisplay = true
    }
  }

  override func updateTrackingAreas() {
    for area in trackingAreas { removeTrackingArea(area) }
    addTrackingArea(
      NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways], owner: self))
    super.updateTrackingAreas()
  }
  override func mouseEntered(with event: NSEvent) {
    hovering = true
    hoverChange?(true)
    needsDisplay = true
  }
  override func mouseExited(with event: NSEvent) {
    hovering = false
    hoverChange?(false)
    needsDisplay = true
  }
  override func accessibilityPerformPress() -> Bool {
    click?()
    return true
  }
  override func menu(for event: NSEvent) -> NSMenu? {
    let menu = NSMenu()
    for (title, action) in [("Disable pet", "disable"), ("Pet settings", "settings"), ("Open nohmi", "open")] {
      let item = NSMenuItem(title: title, action: #selector(contextMenuAction(_:)), keyEquivalent: "")
      item.target = self
      item.representedObject = action
      menu.addItem(item)
    }
    return menu
  }
  @objc private func contextMenuAction(_ item: NSMenuItem) {
    guard let name = item.representedObject as? String else { return }
    contextAction?(name)
  }
  static func facialColor(for color: NSColor) -> NSColor {
    let rgb = color.usingColorSpace(.sRGB) ?? color
    func linear(_ value: CGFloat) -> CGFloat {
      value <= 0.04045 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
    }
    let luminance = 0.2126 * linear(rgb.redComponent) + 0.7152 * linear(rgb.greenComponent)
      + 0.0722 * linear(rgb.blueComponent)
    return luminance > 0.179 ? .black : .white
  }
  override func mouseDown(with event: NSEvent) {
    origin = NSEvent.mouseLocation
    dragged = false
    dragStart?()
  }
  override func mouseDragged(with event: NSEvent) {
    guard let origin else { return }
    let current = NSEvent.mouseLocation
    if hypot(current.x - origin.x, current.y - origin.y) > 4 { dragged = true }
    if dragged {
      dragChange?()
      needsDisplay = true
    }
  }
  override func mouseUp(with event: NSEvent) {
    moved?()
    if !dragged { click?() }
    origin = nil
    dragged = false
    needsDisplay = true
  }
  override func draw(_ dirtyRect: NSRect) {
    // Original bundled creature artwork drawn into a small native sprite; no web view or network animation.
    let reduced = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    let time = CACurrentMediaTime()
    let bob: CGFloat = reduced || peeking || dragged ? 0 : CGFloat(sin(time * .pi / 1.8)) * 0.65
    if reduced { hoverAmount = hovering && !peeking ? 1 : 0 }
    NSGraphicsContext.saveGraphicsState()
    defer { NSGraphicsContext.restoreGraphicsState() }
    if peeking {
      NSBezierPath(
        rect: NSRect(x: 0, y: peekOcclusion, width: 72, height: max(0, 72 - peekOcclusion))
      ).addClip()
    }
    let transform = NSAffineTransform()
    transform.translateX(by: 36, yBy: 32)
    transform.scale(by: transitionScale)
    transform.translateX(by: -36, yBy: -32)
    transform.concat()
    let acknowledged = acknowledgedAt.map { max(0, 1 - (time - $0) / 0.45) } ?? 0
    let earLift: CGFloat = reduced ? 0 : CGFloat(sin(acknowledged * .pi)) * 2
    let body = NSBezierPath(
      roundedRect: NSRect(x: 13, y: 12 + bob, width: 46, height: 40 + hoverAmount * 2), xRadius: 19,
      yRadius: 19)
    NSGraphicsContext.saveGraphicsState()
    let shadow = NSShadow()
    shadow.shadowColor = NSColor.black.withAlphaComponent(0.18)
    shadow.shadowBlurRadius = 4
    shadow.shadowOffset = NSSize(width: 0, height: -2)
    shadow.set()
    color.setFill()
    body.fill()
    NSGraphicsContext.restoreGraphicsState()
    color.setFill()
    NSBezierPath(ovalIn: NSRect(x: 13, y: 39 + bob, width: 14, height: 19 + earLift)).fill()
    NSBezierPath(ovalIn: NSRect(x: 44, y: 39 + bob, width: 14, height: 19 + earLift)).fill()
    Self.facialColor(for: color).setFill()
    let blinkPhase = time.truncatingRemainder(dividingBy: 5.6)
    let blink = reduced || dragged ? 0 : max(0, 1 - abs(blinkPhase - 0.12) / 0.12)
    let eyeHeight: CGFloat = (8.2 + (dragged ? 1 : 0)) * CGFloat(1 - 0.88 * sin(blink * .pi / 2))
    for x in [CGFloat(26), 44] {
      NSBezierPath(
        ovalIn: NSRect(x: x - 0.7, y: 37 + bob - eyeHeight / 2, width: 5.4, height: eyeHeight)
      ).fill()
    }
    let mouth = NSBezierPath()
    mouth.move(to: NSPoint(x: 33, y: 27 + bob))
    mouth.curve(
      to: NSPoint(x: 40, y: 27 + bob), controlPoint1: NSPoint(x: 34, y: 23 + bob),
      controlPoint2: NSPoint(x: 39, y: 23 + bob))
    mouth.lineWidth = 1.5
    Self.facialColor(for: color).setStroke()
    mouth.stroke()
  }
}
