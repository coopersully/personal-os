import AppKit
import QuartzCore

private final class PetSceneView: NSView {
  weak var wakeTarget: NSView?
  var wakeHitFrame = CGRect.null
  override func hitTest(_ point: NSPoint) -> NSView? {
    if wakeHitFrame.contains(point), let wakeTarget { return wakeTarget }
    return super.hitTest(point)
  }
}

private final class PetAnchorView: NSView {
  var anchorFrames: [CGRect] = [] { didSet { if oldValue != anchorFrames { needsDisplay = true } } }
  var candidate: Int? { didSet { if oldValue != candidate { needsDisplay = true } } }
  override func hitTest(_ point: NSPoint) -> NSView? { nil }
  override func draw(_ dirtyRect: NSRect) {
    for (index, rect) in anchorFrames.enumerated() {
      let circle = NSBezierPath(
        ovalIn: CGRect(x: rect.midX - 9, y: rect.midY - 9, width: 18, height: 18))
      NSColor.white.withAlphaComponent(index == candidate ? 1 : 0.4).setFill()
      circle.fill()
      NSColor.black.withAlphaComponent(0.35).setStroke()
      circle.lineWidth = 1
      circle.stroke()
    }
  }
}

/// One moving panel contains the pet and card; a stationary, input-transparent panel draws guides.
/// The Tauri window remains the webview's command owner,
/// but its content view is mounted beside the sprite inside this scene.
final class PetController: NSObject {
  var action: (([String: Any]) -> Void)?
  let panel = PetPanel(
    contentRect: CGRect(x: 0, y: 0, width: 72, height: 72),
    styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
  private let scene = PetSceneView(frame: .zero)
  private let anchors = PetAnchorView(frame: .zero)
  private let anchorPanel = PetPanel(
    contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel],
    backing: .buffered, defer: false)
  private let sprite = PetView(frame: CGRect(x: 0, y: 0, width: 72, height: 72))
  private weak var owner: NSWindow?
  private var dashboard: NSView?
  private let placements: PetPlacementStore
  private var idleEnabled = true
  private var idleDelay: Double = 3
  private var enabled = false, ready = false, sleeping = false
  private var motion = PetTransition(), tuck = PetTransition(), edgeMotion = PetTransition()
  private var settling = PetTransition()
  private var poseCorrection = PetPoseCorrection()
  private var settleFrom = CGRect.zero, settleTo = CGRect.zero
  private var settleCard = false
  private var clock: CADisplayLink?
  private var lastFrame = CACurrentMediaTime()
  private var idleTimer: Timer?
  private var obstacleTimer: Timer?
  private var idlePolicy = PetIdlePolicy()
  private var hovering = false, pendingOpen = false, movedSinceOpening = false
  private var compact = CGRect(x: 0, y: 0, width: 72, height: 72)
  private var card = CGRect(x: 0, y: 0, width: 400, height: 560)
  private var cardFollowsCompact = true
  private var dragTuck = CGRect.zero
  private var savedCardSize = CGSize(width: 400, height: 560)
  private var compactAnchor: Int?, cardAnchor: Int?
  private var attachment: PetAttachment = .top
  private var previousAttachment: PetAttachment = .top
  private var edgeFrom = CGRect.zero
  private var previousAngle: CGFloat = 0
  private var tuckFrame = CGRect.zero
  private var tuckEdge: PetAttachment = .top
  private var visiblePet = CGRect.zero
  private var activeScreen: NSScreen?
  private var geometry = PetGeometry(
    bounds: CGRect(x: 0, y: 0, width: 1000, height: 700), obstacles: [])
  private var dragOrigin: CGPoint?, dragCard = CGRect.zero, dragPet = CGRect.zero
  private var resizeEdge: String?
  private var gestureMoved = false, draggingCard = false, grabbedSprite = false
  private var candidate: Int?
  private var monitors: [Any] = []
  private var observers: [NSObjectProtocol] = []
  private var gesturePending = false
  private var spriteLayout = CGRect.null, dashboardLayout = CGRect.null
  private var spriteAngle: CGFloat = .nan
  private var dashboardTransform = CATransform3DIdentity
  private var lastVisible = false
  private var rendering = false

  init(placements: PetPlacementStore = PetPlacementStore()) {
    self.placements = placements
    super.init()
    panel.title = "nohmi quick access"
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = false
    // Keep the pet reachable while Dock/desktop geometry changes between observations.
    panel.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.dockWindow)) + 1)
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenNone]
    panel.hidesOnDeactivate = false
    panel.isReleasedWhenClosed = false
    panel.isMovableByWindowBackground = false
    panel.acceptsMouseMovedEvents = true
    panel.contentView = scene
    scene.wantsLayer = true
    scene.addSubview(sprite)
    scene.wakeTarget = sprite
    anchorPanel.isOpaque = false
    anchorPanel.backgroundColor = .clear
    anchorPanel.hasShadow = false
    anchorPanel.level = panel.level
    anchorPanel.collectionBehavior = [.canJoinAllSpaces, .fullScreenNone]
    anchorPanel.hidesOnDeactivate = false
    anchorPanel.isReleasedWhenClosed = false
    anchorPanel.ignoresMouseEvents = true
    anchorPanel.contentView = anchors
    anchors.wantsLayer = true
    sprite.wantsLayer = true
    sprite.contextAction = { [weak self] name in
      guard let self else { return }
      self.wake()
      switch name {
      case "disable": self.action?(["action": "pet_disable"])
      case "settings": self.closeOverlay(); self.action?(["action": "open", "path": "/settings?section=pet"])
      default: self.closeOverlay(); self.action?(["action": "open", "path": "/today"])
      }
    }
    sprite.click = { [weak self] in self?.quickAccess() }
    sprite.dragStart = { [weak self] in
      guard let self else { return }
      self.beginGesture(card: self.motion.progress > 0, sprite: true)
    }
    sprite.dragChange = { [weak self] in self?.queueGesture() }
    sprite.moved = { [weak self] in self?.endGesture() }
    sprite.hoverChange = { [weak self] _ in self?.trackPointer() }
    let mask: NSEvent.EventTypeMask = [
      .mouseMoved, .leftMouseDragged, .leftMouseUp, .leftMouseDown, .rightMouseDown,
    ]
    if let monitor = NSEvent.addGlobalMonitorForEvents(
      matching: mask, handler: { [weak self] event in self?.observe(event) })
    {
      monitors.append(monitor)
    }
    if let monitor = NSEvent.addLocalMonitorForEvents(
      matching: mask.union(.keyDown),
      handler: { [weak self] event in
        self?.observe(event)
        if event.type == .keyDown, event.keyCode == 53, event.window === self?.panel {
          self?.closeOverlay()
          return nil
        }
        return event
      })
    {
      monitors.append(monitor)
    }
    observers.append(
      NotificationCenter.default.addObserver(
        forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main
      ) { [weak self] _ in self?.screensChanged() })
    observers.append(
      NotificationCenter.default.addObserver(
        forName: NSWindow.didResignKeyNotification, object: panel, queue: .main
      ) { [weak self] _ in
        guard let self, !self.placements.pinned, self.dragOrigin == nil else { return }
        self.closeOverlay()
      })
    for name in [NSWorkspace.willSleepNotification, NSWorkspace.sessionDidResignActiveNotification]
    {
      observers.append(
        NSWorkspace.shared.notificationCenter.addObserver(forName: name, object: nil, queue: .main)
        { [weak self] _ in
          self?.sleeping = true
          self?.closeOverlay(immediately: true)
          self?.panel.orderOut(nil)
        })
    }
    for name in [NSWorkspace.didWakeNotification, NSWorkspace.sessionDidBecomeActiveNotification] {
      observers.append(
        NSWorkspace.shared.notificationCenter.addObserver(forName: name, object: nil, queue: .main)
        { [weak self] _ in
          self?.sleeping = false
          self?.screensChanged()
          self?.render()
          self?.armIdle()
        })
    }
    restorePosition()
    obstacleTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
      self?.refreshObstacles()
    }
    obstacleTimer?.tolerance = 0.25
  }
  deinit {
    clock?.invalidate()
    idleTimer?.invalidate()
    obstacleTimer?.invalidate()
    monitors.forEach(NSEvent.removeMonitor)
    for observer in observers {
      NotificationCenter.default.removeObserver(observer)
      NSWorkspace.shared.notificationCenter.removeObserver(observer)
    }
  }
  func configure(_ settings: NativeSettings) {
    if let rgb = UInt32(
      settings.petColor.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16)
    {
      sprite.color = NSColor(
        srgbRed: CGFloat((rgb >> 16) & 255) / 255, green: CGFloat((rgb >> 8) & 255) / 255,
        blue: CGFloat(rgb & 255) / 255, alpha: 1)
    }
    let nextDelay = min(300, max(1, settings.petSleepAfterSeconds ?? 3))
    let nextIdle = settings.petSleepEnabled ?? true
    if nextDelay != idleDelay || nextIdle != idleEnabled {
      idleEnabled = nextIdle
      idleDelay = nextDelay
      wake()
      armIdle()
    }
    let scaleChanged = compact.width != 72 * min(2, max(0.5, settings.petScale ?? 1))
    previewScale(settings.petScale ?? 1)
    let wasEnabled = enabled
    enabled = settings.petEnabled
    if wasEnabled && !enabled {
      closeOverlay(immediately: true)
      panel.orderOut(nil)
      sprite.stopAnimation()
    } else if enabled && !wasEnabled {
      render()
      sprite.restartAnimation()
      armIdle()
    } else if scaleChanged {
      render()
      armIdle()
    }
  }
  func previewScale(_ scale: Double) {
    let size = 72 * min(2, max(0.5, scale))
    guard compact.width != size else { return }
    compact.size = CGSize(width: size, height: size)
    if let anchor = compactAnchor, (0..<8).contains(anchor) {
      compact = geometry.anchors(size: compact.size)[anchor]
    } else { compact = geometry.fit(compact) }
    if tuck.progress > 0, let anchor = compactAnchor,
      let pose = geometry.tucked(frame: compact, anchor: anchor) {
      tuckFrame = pose.0
      tuckEdge = pose.1
    } else { tuckFrame = .zero; tuck.request(open: false, immediately: true) }
    updateAttachment()
    render()
  }
  private var sceneActive: Bool { enabled || motion.target == 1 || motion.progress > 0 }
  func quickAccess() {
    wake()
    if tuck.progress > 0 {
      pendingOpen = true
      startClock()
      return
    }
    action?(["action": "pet_toggle"])
  }
  private func attach(_ address: UInt64) throws {
    guard
      let window = NSApp.windows.first(where: {
        UInt64(UInt(bitPattern: Unmanaged.passUnretained($0).toOpaque())) == address
      })
    else { throw NativeError.message("The quick-access window is unavailable.") }
    if owner === window, dashboard != nil { return }
    dashboard?.removeFromSuperview()
    guard let content = window.contentView else {
      throw NativeError.message("The quick-access content is unavailable.")
    }
    owner = window
    ready = false
    window.orderOut(nil)
    window.contentView = NSView(frame: content.frame)
    content.removeFromSuperview()
    content.autoresizingMask = []
    content.wantsLayer = true
    // Let the webview initialize without flashing content before its ready handshake.
    content.alphaValue = 0
    dashboard = content
    dashboardLayout = .null
    dashboardTransform = CATransform3DIdentity
    scene.addSubview(content, positioned: .above, relativeTo: sprite)
    content.isHidden = false
  }
  func prepareOverlay(windowAddress: UInt64) throws {
    try attach(windowAddress)
    requestOpen(true)
  }
  func readyOverlay(windowAddress: UInt64) throws {
    try attach(windowAddress)
    ready = true
    if motion.target == 1 { startClock() }
    render()
  }
  func toggleOverlay(windowAddress: UInt64) throws {
    try attach(windowAddress)
    requestOpen(motion.target == 0)
  }
  private func requestOpen(_ open: Bool) {
    if !open {
      closeOverlay()
      return
    }
    wake()
    pendingOpen = false
    if open && motion.progress == 0 {
      refreshGeometry(at: CGPoint(x: compact.midX, y: compact.midY), force: true)
      if cardFollowsCompact {
        card = geometry.card(
          size: savedCardSize, anchor: cardAnchor ?? compactAnchor,
          near: CGPoint(x: compact.midX, y: compact.midY))
      }
      updateAttachment()
      movedSinceOpening = false
      cardFollowsCompact = false
    }
    motion.request(open: open)
    if ready { startClock() }
  }
  func closeOverlay(immediately: Bool = false) {
    pendingOpen = false
    cancelIdle()
    settling.request(open: false, immediately: true)
    if movedSinceOpening && visiblePet != .zero {
      let previous = compact.origin
      compact = geometry.closedPet(frame: visiblePet, size: compact.size, anchor: cardAnchor)
      compactAnchor = cardAnchor
      poseCorrection.rebase(from: previous, to: compact.origin, at: motion.progress)
      movedSinceOpening = false
    }
    motion.request(open: false, immediately: immediately)
    dragOrigin = nil
    resizeEdge = nil
    candidate = nil
    if immediately {
      poseCorrection.reset()
      tuck.request(open: false, immediately: true)
      clock?.invalidate()
      clock = nil
      dashboard?.isHidden = true
      render()
    } else if ready {
      startClock()
    }
  }
  func clearOverlay() {
    closeOverlay(immediately: true)
    dashboard?.removeFromSuperview()
    dashboard = nil
    owner = nil
    ready = false
  }
  var presentationState: [String: Any] {
    ["pinned": placements.pinned, "visible": ready && motion.target == 1, "state": motion.state]
  }
  func acknowledgeCompletion() { sprite.acknowledgeCompletion() }
  func setPinned(_ value: Bool) {
    placements.pinned = value
    publish()
    render()
  }
  private func publish() {
    action?([
      "action": "pet_presentation", "pinned": placements.pinned,
      "visible": ready && motion.target == 1,
    ])
  }
  private func refreshGeometry(at point: CGPoint, force: Bool = false) {
    guard let screen = PetDisplays.at(point) else { return }
    let key = NSDeviceDescriptionKey("NSScreenNumber")
    let changedDisplay =
      (activeScreen?.deviceDescription[key] as? NSNumber)
      != (screen.deviceDescription[key] as? NSNumber)
    if force || changedDisplay {
      activeScreen = screen
      geometry = PetDisplays.geometry(screen)
    }
  }
  private func refreshObstacles() {
    guard sceneActive, !sleeping, dragOrigin == nil, let screen = activeScreen else { return }
    let next = PetDisplays.geometry(screen)
    guard next != geometry else { return }
    geometry = next
    // A moved Dock invalidates both a saved resting point and a hide corridor.
    settling.request(open: false, immediately: true)
    if let anchor = compactAnchor, (0..<8).contains(anchor) {
      compact = geometry.anchors(size: compact.size)[anchor]
    } else {
      compact = geometry.fit(compact)
    }
    card = geometry.fitCard(card)
    tuck.request(open: false, immediately: true)
    tuckFrame = .zero
    cancelIdle()
    updateAttachment()
    render()
    save()
    armIdle()
  }
  private func updateAttachment() {
    let edge = geometry.attachment(card: card, petSize: compact.width, preferred: attachment)
    guard edge != attachment else { return }
    edgeFrom =
      visiblePet == .zero
      ? geometry.petFrame(card: card, size: compact.width, edge: attachment) : visiblePet
    previousAngle = interpolatedAngle()
    previousAttachment = attachment
    attachment = edge
    edgeMotion.request(open: false, immediately: true)
    edgeMotion.request(open: true)
    if ready && motion.progress > 0 {
      startClock()
    } else {
      edgeMotion.request(open: true, immediately: true)
    }
  }
  private func interpolatedAngle() -> CGFloat {
    previousAngle + (attachment.angle - previousAngle) * edgeMotion.progress
  }
  private func attachedFrame() -> CGRect {
    let end = geometry.petFrame(card: card, size: compact.width, edge: attachment)
    guard !edgeMotion.isSettled, attachment != .hidden, previousAttachment != .hidden else {
      return end
    }
    let t = edgeMotion.progress
    // Opposite edges travel around the less obstructed side instead of through card content.
    if (previousAttachment == .top && attachment == .bottom)
      || (previousAttachment == .bottom && attachment == .top)
    {
      let x =
        card.midX > geometry.bounds.midX
        ? card.minX - compact.width * 0.45 : card.maxX - compact.width * 0.55
      if t < 0.25 {
        return interpolate(
          edgeFrom, CGRect(origin: CGPoint(x: x, y: edgeFrom.minY), size: end.size), t * 4)
      }
      if t < 0.75 {
        return CGRect(
          origin: CGPoint(x: x, y: edgeFrom.minY + (end.minY - edgeFrom.minY) * (t - 0.25) * 2),
          size: end.size)
      }
      return interpolate(
        CGRect(origin: CGPoint(x: x, y: end.minY), size: end.size), end, (t - 0.75) * 4)
    }
    return interpolate(edgeFrom, end, t)
  }
  private func interpolate(_ a: CGRect, _ b: CGRect, _ progress: Double) -> CGRect {
    CGRect(
      x: a.minX + (b.minX - a.minX) * progress, y: a.minY + (b.minY - a.minY) * progress,
      width: a.width + (b.width - a.width) * progress,
      height: a.height + (b.height - a.height) * progress)
  }
  private func startClock() {
    guard sceneActive, !sleeping, clock == nil else { return }
    let next = sprite.displayLink(target: self, selector: #selector(frame(_:)))
    next.preferredFrameRateRange = CAFrameRateRange(minimum: 30, maximum: 120, preferred: 60)
    lastFrame = CACurrentMediaTime()
    next.add(to: .main, forMode: .common)
    clock = next
  }
  @objc private func frame(_ sender: CADisplayLink) {
    let now = CACurrentMediaTime()
    let dt = now - lastFrame
    lastFrame = now
    let reduced = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    if gesturePending { updateGesture() }
    if dragOrigin == nil {
      if ready { motion.advance(seconds: dt, reducedMotion: reduced) }
      if motion.isSettled { poseCorrection.reset() }
      tuck.advance(seconds: dt, reducedMotion: reduced)
    }
    if dragOrigin == nil || !grabbedSprite {
      edgeMotion.advance(seconds: dt, reducedMotion: reduced)
    }
    if !settling.isSettled {
      settling.advance(seconds: dt, reducedMotion: reduced)
      let placement = interpolate(settleFrom, settleTo, settling.progress)
      if settleCard { card = placement } else { compact = placement }
      if settling.isSettled {
        updateAttachment()
        save()
      }
    }
    render()
    if tuck.isSettled && tuck.progress == 0 && pendingOpen {
      pendingOpen = false
      action?(["action": "pet_toggle"])
    }
    if dragOrigin == nil && motion.isSettled && tuck.isSettled && edgeMotion.isSettled
      && settling.isSettled
    {
      sender.invalidate()
      clock = nil
      if motion.progress == 0 {
        save()
        armIdle()
      }
    }
  }
  private func render() {
    guard !rendering else { return }
    rendering = true
    defer { rendering = false }
    let p = ready ? motion.progress : 0
    let reduced = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    let attached = attachedFrame()
    var petFrame = interpolate(compact, attached, reduced ? (p == 1 ? 1 : 0) : p)
    if p == 0 && tuckFrame != .zero {
      petFrame = interpolate(
        compact, tuckFrame, reduced ? (tuck.progress == 1 ? 1 : 0) : tuck.progress)
    }
    let correction = reduced ? CGPoint.zero : poseCorrection.offset(at: p)
    petFrame = petFrame.offsetBy(dx: correction.x, dy: correction.y)
    if geometry.obstacles.contains(where: { $0.intersects(petFrame) }) {
      petFrame = geometry.fit(petFrame)
    }
    visiblePet = petFrame
    // A tucked sprite extends offscreen. Assistive input must target its exposed face.
    sprite.visibleAccessibilityFrame = petFrame.intersection(geometry.bounds)
    let wakeHitFrame = geometry.compactHitFrame(
      compact: compact, visible: petFrame, tucked: tuckFrame,
      keepWakeArea: p == 0 && (tuck.progress > 0 || hovering))
    var envelope = p == 1 ? petFrame : compact.union(petFrame)
    if p == 0 { envelope = envelope.union(wakeHitFrame) }
    if p > 0 { envelope = envelope.union(card).union(attached) }
    envelope = envelope.intersection(geometry.bounds)
    guard !envelope.isNull else { return }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    let nextFrame = envelope.integral
    if panel.frame.size != nextFrame.size {
      panel.setFrame(nextFrame, display: false)
    } else if panel.frame.origin != nextFrame.origin {
      panel.setFrameOrigin(nextFrame.origin)
    }
    if scene.frame.size != panel.frame.size {
      scene.frame = CGRect(origin: .zero, size: panel.frame.size)
    }
    let origin = panel.frame.origin
    // Keep the exposed face reachable while hover reveals it. Otherwise the sprite
    // moves away between pointer entry and mouse-down, swallowing the first click.
    scene.wakeHitFrame =
      p == 0
      ? wakeHitFrame.offsetBy(dx: -origin.x, dy: -origin.y) : .null
    let petLayout = petFrame.offsetBy(dx: -origin.x, dy: -origin.y)
    let angle = p > 0 ? interpolatedAngle() * p : tuckEdge.angle * tuck.progress
    if petLayout != spriteLayout || angle != spriteAngle {
      sprite.layer?.transform = CATransform3DIdentity
      sprite.frame = petLayout
      sprite.setBoundsSize(CGSize(width: 72, height: 72))
      sprite.layer?.anchorPoint = CGPoint(x: 0.5, y: 0.5)
      sprite.layer?.position = CGPoint(x: petLayout.midX, y: petLayout.midY)
      sprite.layer?.setAffineTransform(CGAffineTransform(rotationAngle: angle * .pi / 180)
        .scaledBy(x: petFrame.width / 72, y: petFrame.height / 72))
      spriteLayout = petLayout
      spriteAngle = angle
    }
    sprite.peeking = p > 0 || tuck.progress > 0
    sprite.peekOcclusion = 32 * PetTransition.ramp(p, from: 0.65, to: 1)
    sprite.isHidden = p > 0.95 && attachment == .hidden
    sprite.animationActive = sceneActive && !sleeping && !sprite.isHidden && dragOrigin == nil
    if let dashboard {
      dashboard.isHidden = ready && p == 0
      let layout = card.offsetBy(dx: -origin.x, dy: -origin.y)
      let layoutChanged = layout != dashboardLayout
      if layoutChanged {
        dashboard.layer?.transform = CATransform3DIdentity
        dashboard.frame = layout
        dashboard.layer?.anchorPoint = CGPoint(x: 0.5, y: 0.5)
        dashboard.layer?.position = CGPoint(x: layout.midX, y: layout.midY)
        dashboardLayout = layout
      }
      let scale = reduced ? 1 : max(0.08, p)
      let dx = reduced ? 0 : (compact.midX - card.midX) * (1 - p) + correction.x
      let dy = reduced ? 0 : (compact.midY - card.midY) * (1 - p) + correction.y
      let transform = CATransform3DConcat(
        CATransform3DMakeScale(scale, scale, 1), CATransform3DMakeTranslation(dx, dy, 0))
      if layoutChanged || !CATransform3DEqualToTransform(transform, dashboardTransform) {
        dashboard.layer?.transform = transform
        dashboardTransform = transform
      }
      let alpha = min(1, p * 4)
      if dashboard.alphaValue != alpha { dashboard.alphaValue = alpha }
    }
    updateAnchorGuides()
    // Readiness can be announced more than once before the first animation frame.
    // Keep focus through that starting pose instead of treating progress == 0 as closed.
    panel.acceptsKeyboard = ready && motion.target == 1
    if !panel.acceptsKeyboard && panel.isKeyWindow { panel.resignKey() }
    if sceneActive && !sleeping {
      if !panel.isVisible { panel.orderFrontRegardless() }
    } else if panel.isVisible {
      panel.orderOut(nil)
    }
    CATransaction.commit()
    let visible = ready && motion.target == 1
    if visible != lastVisible {
      lastVisible = visible
      publish()
      if visible {
        panel.makeKey()
        if let dashboard { panel.makeFirstResponder(dashboard) }
      }
    }
    trackPointer()
  }
  private func updateAnchorGuides() {
    guard sceneActive, !sleeping, dragOrigin != nil, resizeEdge == nil else {
      if anchorPanel.isVisible { anchorPanel.orderOut(nil) }
      return
    }
    let frame = geometry.bounds.integral
    if anchorPanel.frame != frame { anchorPanel.setFrame(frame, display: false) }
    anchors.anchorFrames = geometry.anchors(size: compact.size).map {
      $0.offsetBy(dx: -frame.minX, dy: -frame.minY)
    }
    anchors.candidate = candidate
    if !anchorPanel.isVisible {
      anchorPanel.order(.above, relativeTo: panel.windowNumber)
    }
  }
  func trackPointer(at point: CGPoint = NSEvent.mouseLocation) {
    let petHit = geometry.compactHitFrame(
      compact: compact, visible: visiblePet, tucked: tuckFrame,
      keepWakeArea: motion.progress == 0 && (tuck.progress > 0 || hovering)
    ).contains(point)
    let corridor =
      tuck.progress > 0 || hovering
      ? compact.union(tuckFrame == .zero ? compact : tuckFrame) : visiblePet
    let wasHovering = hovering
    hovering = motion.progress == 0 && corridor.intersection(geometry.bounds).contains(point)
    // The compact panel already hugs its hit area. Keep it receptive without waiting
    // for an out-of-process mouse monitor to re-enable input on pointer entry.
    panel.ignoresMouseEvents =
      motion.progress > 0 && dragOrigin == nil && !petHit && !card.contains(point)
    if hovering { wake() } else if wasHovering { armIdle() }
  }
  private func observe(_ event: NSEvent) {
    guard sceneActive, !sleeping else { return }
    if event.type == .leftMouseDragged && dragOrigin != nil { queueGesture() }
    if event.type == .leftMouseUp && dragOrigin != nil { endGesture() }
    if [.leftMouseDown, .rightMouseDown].contains(event.type), motion.target == 1,
      !placements.pinned,
      !card.union(visiblePet).contains(NSEvent.mouseLocation), dragOrigin == nil
    {
      closeOverlay()
    }
    if event.type == .mouseMoved { trackPointer() }
  }
  private func cancelIdle() {
    idleTimer?.invalidate()
    idleTimer = nil
    _ = idlePolicy.update(now: CACurrentMediaTime(), eligible: false)
  }
  private func wake() {
    cancelIdle()
    if tuck.target == 1 {
      tuck.request(open: false)
      startClock()
    }
  }
  private func idleEligible() -> Bool {
    guard enabled, idleEnabled, !sleeping, motion.progress == 0, motion.target == 0, dragOrigin == nil,
      !hovering,
      !panel.isKeyWindow, let anchor = compactAnchor, (0..<8).contains(anchor)
    else { return false }
    let target = geometry.anchors(size: compact.size)[anchor]
    return hypot(target.midX - compact.midX, target.midY - compact.midY) < 8
      && geometry.tucked(frame: compact, anchor: anchor) != nil
  }
  private func armIdle() {
    guard idleTimer == nil, tuck.progress == 0, idleEligible() else { return }
    _ = idlePolicy.update(now: CACurrentMediaTime(), eligible: true)
    idleTimer = Timer.scheduledTimer(withTimeInterval: idleDelay, repeats: false) { [weak self] _ in
      guard let self else { return }
      self.idleTimer = nil
      guard self.idlePolicy.update(now: CACurrentMediaTime(), eligible: self.idleEligible(), delay: self.idleDelay),
        let anchor = self.compactAnchor,
        let pose = self.geometry.tucked(frame: self.compact, anchor: anchor)
      else { return }
      self.tuckFrame = pose.0
      self.tuckEdge = pose.1
      self.tuck.request(open: true)
      self.startClock()
    }
  }
  private func beginGesture(card isCard: Bool, edge: String? = nil, sprite: Bool = false) {
    wake()
    pendingOpen = false
    guard enabled || isCard && motion.target == 1 else { return }
    settling.request(open: false, immediately: true)
    draggingCard = isCard
    grabbedSprite = sprite
    resizeEdge = edge
    dragOrigin = NSEvent.mouseLocation
    refreshGeometry(at: NSEvent.mouseLocation, force: true)
    dragCard = card
    dragPet = compact
    dragTuck = tuckFrame
    gestureMoved = false
    gesturePending = false
    startClock()
  }
  func prepareDrag() {
    guard ready, motion.target == 1, NSEvent.pressedMouseButtons & 1 != 0 else { return }
    motion.request(open: true)
    beginGesture(card: true)
    render()
  }
  func prepareResize(edge: String) {
    guard ["n", "s", "e", "w", "ne", "nw", "se", "sw"].contains(edge), ready,
      NSEvent.pressedMouseButtons & 1 != 0
    else { return }
    motion.request(open: true)
    beginGesture(card: true, edge: edge)
    render()
  }
  private func queueGesture() {
    guard dragOrigin != nil else { return }
    gesturePending = true
    startClock()
  }
  private func updateGesture() {
    gesturePending = false
    guard let start = dragOrigin else { return }
    let pointer = NSEvent.mouseLocation
    let dx = pointer.x - start.x
    let dy = pointer.y - start.y
    guard gestureMoved || hypot(dx, dy) >= 4 else { return }
    gestureMoved = true
    if tuck.progress > 0 {
      tuck.request(open: false, immediately: true)
      tuckFrame = .zero
      dragTuck = .zero
    }
    refreshGeometry(at: pointer)
    if let edge = resizeEdge {
      var frame = dragCard
      if edge.contains("e") { frame.size.width = max(320, dragCard.width + dx) }
      if edge.contains("w") {
        frame.size.width = max(320, dragCard.width - dx)
        frame.origin.x = dragCard.maxX - frame.width
      }
      if edge.contains("n") { frame.size.height = max(320, dragCard.height + dy) }
      if edge.contains("s") {
        frame.size.height = max(320, dragCard.height - dy)
        frame.origin.y = dragCard.maxY - frame.height
      }
      card = geometry.fitCard(frame)
      savedCardSize = card.size
      movedSinceOpening = true
      updateAttachment()
    } else if draggingCard {
      let previousCard = card
      card = geometry.fitCard(dragCard.offsetBy(dx: dx, dy: dy))
      cardAnchor = nil
      movedSinceOpening = true
      let shiftX = card.minX - dragCard.minX
      let shiftY = card.minY - dragCard.minY
      edgeFrom = edgeFrom.offsetBy(
        dx: card.minX - previousCard.minX, dy: card.minY - previousCard.minY)
      if motion.progress < 1 { compact = dragPet.offsetBy(dx: shiftX, dy: shiftY) }
      updateAttachment()
    } else {
      compact = geometry.fit(dragPet.offsetBy(dx: dx, dy: dy))
      if dragTuck != .zero {
        tuckFrame = dragTuck.offsetBy(
          dx: compact.minX - dragPet.minX, dy: compact.minY - dragPet.minY)
      }
      compactAnchor = nil
      cardAnchor = nil
      movedSinceOpening = false
      cardFollowsCompact = true
    }
    candidate = resizeEdge == nil ? geometry.snap(cursor: pointer, size: compact.size) : nil
  }
  func snapCard(to anchor: Int) {
    guard (0..<8).contains(anchor) else { return }
    cardAnchor = anchor
    card = geometry.card(size: savedCardSize, anchor: anchor, near: .zero)
    movedSinceOpening = true
    updateAttachment()
  }
  private func endGesture() {
    guard dragOrigin != nil else { return }
    // Commit the release cursor and current obstacles even between display frames.
    refreshGeometry(at: NSEvent.mouseLocation, force: true)
    updateGesture()
    if gestureMoved, let anchor = candidate {
      settleCard = draggingCard
      settleFrom = draggingCard ? card : compact
      if draggingCard {
        snapCard(to: anchor)
      } else {
        compactAnchor = anchor
        cardAnchor = anchor
        compact = geometry.anchors(size: compact.size)[anchor]
      }
      settleTo = draggingCard ? card : compact
      if draggingCard { card = settleFrom } else { compact = settleFrom }
      settling.request(open: false, immediately: true)
      settling.request(open: true)
      startClock()
    }
    dragOrigin = nil
    resizeEdge = nil
    candidate = nil
    if !motion.isSettled || !tuck.isSettled { startClock() }
    if gestureMoved && settling.isSettled { save() }
    render()
    armIdle()
  }
  func moveOverlay(dx: CGFloat, dy: CGFloat) {
    guard ready, motion.target == 1 else { return }
    wake()
    card = geometry.fitCard(card.offsetBy(dx: dx, dy: dy))
    cardAnchor = nil
    movedSinceOpening = true
    updateAttachment()
    render()
    save()
  }
  func resizeOverlay(dw: CGFloat, dh: CGFloat) {
    guard ready, motion.target == 1 else { return }
    savedCardSize = CGSize(width: max(320, card.width + dw), height: max(320, card.height + dh))
    card = geometry.card(
      size: savedCardSize, anchor: cardAnchor, near: CGPoint(x: card.midX, y: card.midY))
    updateAttachment()
    render()
    save()
  }
  private func screensChanged() {
    wake()
    tuck.request(open: false, immediately: true)
    tuckFrame = .zero
    if let activeScreen,
      NSScreen.screens.contains(where: { PetDisplays.id($0) == PetDisplays.id(activeScreen) })
    {
      geometry = PetDisplays.geometry(activeScreen)
      if let anchor = compactAnchor, (0..<8).contains(anchor) {
        compact = geometry.anchors(size: compact.size)[anchor]
      } else {
        compact = geometry.fit(compact)
      }
      card = geometry.card(
        size: savedCardSize, anchor: cardAnchor, near: CGPoint(x: card.midX, y: card.midY))
    } else {
      restorePosition()
    }
    updateAttachment()
    render()
    armIdle()
  }
  func resetPosition() {
    closeOverlay(immediately: true)
    let screen = activeScreen
    placements.reset()
    tuckFrame = .zero
    movedSinceOpening = false
    restorePosition(on: screen)
    render()
    armIdle()
  }
  func restorePosition(on preferredScreen: NSScreen? = nil) {
    let screen = preferredScreen ??
      NSScreen.screens.first(where: { PetDisplays.id($0) == placements.activeDisplay })
      ?? NSScreen.screens.first(where: {
        ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.stringValue
          == placements.legacyDisplay
      }) ?? NSScreen.main ?? NSScreen.screens.first
    guard let screen else { return }
    activeScreen = screen
    geometry = PetDisplays.geometry(screen)
    placements.migrateLegacy(
      display: PetDisplays.id(screen), visible: screen.visibleFrame,
      geometry: geometry, size: compact.size)
    let saved = placements.load(PetDisplays.id(screen))
    cardFollowsCompact = saved == nil
    compactAnchor = saved?.anchor ?? (saved == nil ? 4 : nil)
    cardAnchor = saved?.cardAnchor ?? compactAnchor
    savedCardSize = CGSize(
      width: min(1200, max(320, saved?.width ?? 400)),
      height: min(1200, max(320, saved?.height ?? 560)))
    let b = geometry.bounds
    compact.origin = CGPoint(
      x: b.minX + (saved?.x ?? 0.9) * max(0, b.width - compact.width),
      y: b.minY + (saved?.y ?? 0.1) * max(0, b.height - compact.height))
    if let anchor = compactAnchor, (0..<8).contains(anchor) {
      compact = geometry.anchors(size: compact.size)[anchor]
    } else {
      compact = geometry.fit(compact)
    }
    let near = CGPoint(
      x: b.minX + (saved?.cardX ?? 0.8) * b.width, y: b.minY + (saved?.cardY ?? 0.5) * b.height)
    card = geometry.card(size: savedCardSize, anchor: cardAnchor, near: near)
    updateAttachment()
  }
  private func save() {
    guard enabled, let screen = activeScreen else { return }
    if cardFollowsCompact {
      card = geometry.card(
        size: savedCardSize, anchor: cardAnchor ?? compactAnchor,
        near: CGPoint(x: compact.midX, y: compact.midY))
    }
    let b = geometry.bounds
    let pet = movedSinceOpening && motion.progress > 0
      ? geometry.closedPet(frame: visiblePet, size: compact.size, anchor: cardAnchor) : compact
    placements.save(
      PetSavedPlacement(
        x: Double((pet.minX - b.minX) / max(1, b.width - pet.width)),
        y: Double((pet.minY - b.minY) / max(1, b.height - pet.height)),
        anchor: movedSinceOpening ? cardAnchor : compactAnchor,
        cardX: Double((card.midX - b.minX) / max(1, b.width)),
        cardY: Double((card.midY - b.minY) / max(1, b.height)),
        cardAnchor: cardAnchor, width: savedCardSize.width, height: savedCardSize.height),
      display: PetDisplays.id(screen))
  }
  func clampAndSave() {
    compact = geometry.fit(compact)
    render()
    save()
  }
  static func clamped(_ point: NSPoint, to frame: NSRect, size: NSSize) -> NSPoint {
    CGPoint(
      x: min(max(point.x, frame.minX), max(frame.minX, frame.maxX - size.width)),
      y: min(max(point.y, frame.minY), max(frame.minY, frame.maxY - size.height)))
  }
}
