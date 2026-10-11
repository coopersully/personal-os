import AppKit
import QuartzCore

final class PetPanel: NSPanel {
  var acceptsKeyboard = false
  override var canBecomeKey: Bool { acceptsKeyboard }
  override var canBecomeMain: Bool { false }
}
final class PetView: NSView {
  var visibleAccessibilityFrame = CGRect.zero
  var poseAngle: CGFloat = 0 { didSet { if oldValue != poseAngle { needsDisplay = true } } }
  private var artwork = PetSilhouette.path()
  private var artworkTransform: CGAffineTransform {
    CGAffineTransform(translationX: 36, y: 36).rotated(by: poseAngle * .pi / 180)
      .translatedBy(x: 0, y: -4).scaledBy(x: transitionScale, y: transitionScale)
      .translatedBy(x: -36, y: -32)
  }
  func containsArtwork(_ local: CGPoint) -> Bool {
    let point = local.applying(artworkTransform.inverted())
    return bounds.contains(local) && artwork.contains(point) && (!peeking || point.y >= peekOcclusion)
  }
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
  private var blinkTimer: Timer?
  var hasAnimationClock: Bool { displayClock != nil }
  private var hoverAmount: CGFloat = 0
  private var acknowledgedAt: Double?
  func acknowledgeCompletion() {
    acknowledgedAt = CACurrentMediaTime()
    restartAnimation()
    needsDisplay = true
  }
  private var lastFrame = CACurrentMediaTime()
  var animationActive = false {
    didSet {
      if oldValue != animationActive { animationActive ? restartAnimation() : stopAnimation() }
    }
  }
  var peeking = false { didSet { if oldValue != peeking { needsDisplay = true; restartAnimation() } } }
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
    blinkTimer?.invalidate()
    displayClock?.invalidate()
    NotificationCenter.default.removeObserver(self)
    NSWorkspace.shared.notificationCenter.removeObserver(self)
  }
  override func viewDidMoveToWindow() { restartAnimation() }
  @objc func stopAnimation() {
    blinkTimer?.invalidate()
    blinkTimer = nil
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
    guard window?.isVisible == true else { stopAnimation(); return }
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
    if peeking && abs(target - hoverAmount) < 0.001 && phase >= 0.3
      && !(acknowledgedAt.map { now - $0 < 0.5 } ?? false) {
      stopAnimation()
      blinkTimer = Timer.scheduledTimer(withTimeInterval: max(0.01, 5.6 - phase), repeats: false) { [weak self] _ in
        self?.restartAnimation()
      }
      blinkTimer?.tolerance = 0.02
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
  override func hitTest(_ point: NSPoint) -> NSView? {
    guard !isHidden, alphaValue > 0 else { return nil }
    let local = convert(point, from: superview)
    guard containsArtwork(local) else { return nil }
    return self
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
  static func eyeRects(height: CGFloat, bob: CGFloat) -> [CGRect] {
    [CGFloat(27), 45].map { center in
      CGRect(x: center - 2.7, y: 37 + bob - height / 2, width: 5.4, height: height)
    }
  }
  override func draw(_ dirtyRect: NSRect) {
    // Original bundled creature artwork drawn into a small native sprite; no web view or network animation.
    let reduced = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    let time = CACurrentMediaTime()
    let bob: CGFloat = reduced || peeking || dragged ? 0 : CGFloat(sin(time * .pi / 1.8)) * 0.65
    if reduced { hoverAmount = hovering && !peeking ? 1 : 0 }
    NSGraphicsContext.saveGraphicsState()
    defer { NSGraphicsContext.restoreGraphicsState() }
    let context = NSGraphicsContext.current!.cgContext
    context.concatenate(artworkTransform)
    if peeking {
      NSBezierPath(
        rect: NSRect(x: 0, y: peekOcclusion, width: 72, height: max(0, 72 - peekOcclusion))
      ).addClip()
    }
    let acknowledged = acknowledgedAt.map { max(0, 1 - (time - $0) / 0.45) } ?? 0
    let earLift: CGFloat = reduced ? 0 : CGFloat(sin(acknowledged * .pi)) * 2
    artwork = PetSilhouette.path(bob: bob, hover: hoverAmount, earLift: earLift)
    NSGraphicsContext.saveGraphicsState()
    let shadow = NSShadow()
    shadow.shadowColor = NSColor.black.withAlphaComponent(0.18)
    shadow.shadowBlurRadius = 4
    shadow.shadowOffset = NSSize(width: 0, height: -2)
    shadow.set()
    color.setFill()
    context.addPath(artwork)
    context.fillPath()
    NSGraphicsContext.restoreGraphicsState()
    Self.facialColor(for: color).setFill()
    let blinkPhase = time.truncatingRemainder(dividingBy: 5.6)
    let blink = reduced || dragged ? 0 : max(0, 1 - abs(blinkPhase - 0.12) / 0.12)
    let eyeHeight: CGFloat = (8.2 + (dragged ? 1 : 0)) * CGFloat(1 - 0.88 * sin(blink * .pi / 2))
    for rect in Self.eyeRects(height: eyeHeight, bob: bob) {
      NSBezierPath(ovalIn: rect).fill()
    }

  }
}
