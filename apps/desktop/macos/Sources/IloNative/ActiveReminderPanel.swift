import AppKit
import QuartzCore
import SwiftUI

protocol ActiveReminderPresenting: AnyObject {
  var isVisible: Bool { get }
  func show(
    _ items: [ActiveReminderCandidate], preview: Bool,
    pending: Set<String>, errors: [String: String], stale: Bool) throws
  func hide()
  func setSoundEnabled(_ enabled: Bool)
  func completed(_ item: ActiveReminderCandidate)
}
extension ActiveReminderPresenting {
  func setSoundEnabled(_ enabled: Bool) {}
  func completed(_ item: ActiveReminderCandidate) {}
}
private final class ActiveReminderWindow: NSPanel {
  override var canBecomeKey: Bool { true }
  override var canBecomeMain: Bool { false }
}
final class ActiveReminderDragView: NSView {
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  var forwardScroll: ((NSEvent) -> Void)?
  override func scrollWheel(with event: NSEvent) {
    if let forwardScroll { forwardScroll(event) } else { super.scrollWheel(with: event) }
  }
  var dragStarted: (() -> Void)?
  var controlledDrag: ((CGPoint) -> Void)?
  var menuProvider: (() -> NSMenu)?
  override func menu(for event: NSEvent) -> NSMenu? { menuProvider?() }
  var dragChanged: ((CGPoint) -> Void)?
  var dragEnded: (() -> Void)?
  var clicked: ((CGPoint) -> Void)?
  private var moved = false
  var pointer: ((NSEvent) -> CGPoint)?
  private func location(_ event: NSEvent) -> CGPoint {
    pointer?(event) ?? window?.convertPoint(toScreen: event.locationInWindow)
      ?? NSEvent.mouseLocation
  }
  private var origin: (CGPoint, CGRect)?
  var dragOrigin: CGPoint? { origin?.0 }
  override func mouseDown(with event: NSEvent) {
    if let window {
      origin = (location(event), window.frame)
      moved = false
    }
  }
  override func mouseDragged(with event: NSEvent) {
    guard let (point, frame) = origin else { return }
    let current = location(event)
    guard moved || hypot(current.x - point.x, current.y - point.y) >= 4 else { return }
    if !moved { dragStarted?() }
    moved = true
    if let controlledDrag {
      controlledDrag(current)
    } else {
      window?.setFrameOrigin(
        CGPoint(x: frame.minX + current.x - point.x, y: frame.minY + current.y - point.y))
    }
    dragChanged?(current)
  }
  override func mouseUp(with event: NSEvent) {
    guard origin != nil else { return }
    origin = nil
    if moved { dragEnded?() } else { clicked?(location(event)) }
    moved = false
  }
}

final class ActiveReminderResizeView: NSView {
  enum Edge { case corner, north, south, east, west }
  var edge: Edge = .corner
  var menuProvider: (() -> NSMenu)?
  override func menu(for event: NSEvent) -> NSMenu? { menuProvider?() }
  var resizeBegan: (() -> Void)?
  var resizeChanged: (() -> Void)?
  var resizeEnded: (() -> Void)?
  var pointer: ((NSEvent) -> CGPoint)?
  private func location(_ event: NSEvent) -> CGPoint {
    pointer?(event) ?? window?.convertPoint(toScreen: event.locationInWindow)
      ?? NSEvent.mouseLocation
  }
  private var origin: (CGPoint, CGRect)?
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  override func resetCursorRects() {
    addCursorRect(
      bounds, cursor: edge == .north || edge == .south ? .resizeUpDown : .resizeLeftRight)
  }
  override func mouseDown(with event: NSEvent) {
    if let window {
      origin = (location(event), window.frame)
      resizeBegan?()
    }
  }
  override func mouseDragged(with event: NSEvent) {
    guard let window, let (point, frame) = origin else { return }
    let current = location(event)
    var next = frame
    switch edge {
    case .corner, .east:
      next.size.width = max(
        window.contentMinSize.width, min(window.maxSize.width, frame.width + current.x - point.x))
    case .west:
      next.size.width = max(
        window.contentMinSize.width, min(window.maxSize.width, frame.width - current.x + point.x))
      next.origin.x = frame.maxX - next.width
    default: break
    }
    switch edge {
    case .corner, .south:
      next.size.height = max(
        window.contentMinSize.height, min(window.maxSize.height, frame.height - current.y + point.y)
      )
      next.origin.y = frame.maxY - next.height
    case .north:
      next.size.height = max(
        window.contentMinSize.height, min(window.maxSize.height, frame.height + current.y - point.y)
      )
    default: break
    }
    window.setFrame(next, display: true)
    resizeChanged?()
  }
  override func mouseUp(with event: NSEvent) {
    if origin != nil { resizeEnded?() }
    origin = nil
  }

}

/// One window per record: refreshes and completion never move a sibling card.
final class ActiveReminderPanelController: NSObject, ActiveReminderPresenting {
  private var windows: [String: ActiveReminderCardWindow] = [:]
  var panels: [String: NSPanel] { windows.mapValues(\.panel) }
  var complete: ((ActiveReminderCandidate) -> Void)?
  var open: ((ActiveReminderCandidate) -> Void)?
  var snooze: ((ActiveReminderCandidate) -> Void)?
  var settings: (() -> Void)?
  var interactions = ActiveReminderInteractions()
  private(set) var locks = Set<ActiveReminderEdge>()
  private var groupAnchors: [String: Int] = [:]
  private var updatingGroup = false
  private var gesture: GroupGesture?
  private struct GroupGesture {
    var id: String
    var origin: CGPoint
    var frames: [String: CGRect]
    var candidate: ActiveReminderSlot?
    var shake: PetShoo
    var gathered = false
  }
  var store: ActiveReminderStore? { didSet { locks = store?.lockEdges ?? [] } }
  private let mouseButtons: () -> Int
  private let feedback: (ActiveReminderFeedback) -> Void
  private let geometry: (NSScreen) -> PetGeometry
  private var soundEnabled = true
  private var retiring: [String: ActiveReminderCardWindow] = [:]
  private let clock = ActiveReminderClock()
  private var clockTimer: Timer?
  private func startClock() {
    guard clockTimer == nil else { return }
    clock.now = Date()
    clockTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
      self?.clock.now = Date()
    }
  }
  private func updateConnections() {
    guard !updatingGroup else { return }
    let present = Set(windows.keys)
    // Hidden windows keep lock intent; source retirement and a visible separation remove edges.
    let geometric = ActiveReminderGrouping.edges(visibleFrames)
    locks = locks.filter {
      present.contains($0.a) && present.contains($0.b)
        && (windows[$0.a]?.panel.isVisible != true || windows[$0.b]?.panel.isVisible != true
          || geometric.contains($0))
    }
    if let store, store.lockEdges != locks { try? store.saveLockEdges(locks) }
    for (id, window) in windows {
      let occupied = Dictionary(
        uniqueKeysWithValues: windows.compactMap { key, other in
          key != id && other.panel.isVisible ? (key, other.panel.frame) : nil
        })
      window.updateSeams(
        ActiveReminderDocking.seams(frame: window.panel.frame, occupied: occupied),
        occupied: occupied, locks: locks)
    }
  }
  private func play(_ event: ActiveReminderFeedback) { if soundEnabled { feedback(event) } }
  var lastError: String?
  var isVisible: Bool {
    !windows.isEmpty && windows.values.allSatisfy { $0.panel.isVisible && $0.panel.isOnActiveSpace }
  }
  init(
    mouseButtons: @escaping () -> Int = { NSEvent.pressedMouseButtons },
    feedback: @escaping (ActiveReminderFeedback) -> Void = ActiveReminderAudio.play,
    geometry: @escaping (NSScreen) -> PetGeometry = PetDisplays.geometry
  ) {
    self.mouseButtons = mouseButtons
    self.feedback = feedback
    self.geometry = geometry
    super.init()
  }
  func show(
    _ items: [ActiveReminderCandidate], preview: Bool,
    pending: Set<String>, errors: [String: String], stale: Bool
  ) throws {
    let valid = Set(items.map(\.cardID))
    for key in Array(windows.keys) where !valid.contains(key) {
      windows.removeValue(forKey: key)?.close()
    }
    guard !items.isEmpty else {
      clockTimer?.invalidate()
      clockTimer = nil
      updateConnections()
      return
    }
    startClock()
    guard
      let screen = NSScreen.screens.first(where: { $0.frame.contains(NSEvent.mouseLocation) })
        ?? NSScreen.main
    else {
      hide()
      throw NativeError.message("No display is available for active reminders.")
    }
    refitGroups()
    updatingGroup = true
    var failure: Error?
    for item in items {
      let window: ActiveReminderCardWindow
      let isNew = windows[item.cardID] == nil
      if let existing = windows[item.cardID] {
        window = existing
      } else {
        let occupied = windows.values.map { $0.panel.frame }
        let savedScreen =
          NSScreen.screens.first { PetDisplays.id($0) == store?.cardDisplay(card: item.cardID) }
          ?? screen
        window = ActiveReminderCardWindow(
          item: item, screen: savedScreen, occupied: occupied,
          store: store, mouseButtons: mouseButtons, geometry: geometry, clock: clock)
        window.occupied = { [weak self] in
          Dictionary(
            uniqueKeysWithValues: (self?.windows ?? [:]).compactMap { key, other in
              key != item.cardID && other.panel.isVisible ? (key, other.panel.frame) : nil
            })
        }
        window.layoutChanged = { [weak self] in self?.updateConnections() }
        window.dragBegan = { [weak self] in self?.beginGroupDrag(item.cardID) }
        window.dragMoved = { [weak self] point in self?.moveGroupDrag(point) }
        window.dragFinished = { [weak self] in self?.endGroupDrag() }
        window.menuFactory = { [weak self] in self?.menu(for: item.cardID) ?? NSMenu() }
        window.toggleJoin = { [weak self] peer, all in
          self?.toggleJoin(item.cardID, peer: peer, all: all)
        }
        window.feedback = { [weak self] event in self?.play(event) }
        windows[item.cardID] = window
      }
      window.interactions = interactions
      window.item = item
      do {
        try window.show(
          item: item, preview: preview, pending: pending.contains(item.cardID),
          error: errors[item.cardID], stale: stale,
          complete: { [weak self] in self?.complete?(item) },
          open: { [weak self] in self?.open?(item) })
        if isNew && soundEnabled { feedback(.arrival) }
      } catch { failure = error }
    }
    updatingGroup = false
    updateConnections()
    if let failure { throw failure }
  }
  func setSoundEnabled(_ enabled: Bool) { soundEnabled = enabled }
  func completed(_ item: ActiveReminderCandidate) {
    guard let window = windows.removeValue(forKey: item.cardID) else { return }
    // Keep the departing window alive until its acknowledged completion animation ends.
    let token = UUID().uuidString
    retiring[token] = window
    updateConnections()
    if window.panel.isVisible && soundEnabled { feedback(.completion) }
    window.popOut { [weak self] in
      window.close()
      self?.retiring[token] = nil
    }
  }
  func hide() {
    clockTimer?.invalidate()
    clockTimer = nil
    gesture = nil
    for window in windows.values { window.hide() }
    for window in retiring.values { window.close() }
    retiring = [:]
  }
  func reset() {
    clockTimer?.invalidate()
    clockTimer = nil
    for window in windows.values { window.close() }
    for window in retiring.values { window.close() }
    retiring = [:]
    windows = [:]
    locks = []
    gesture = nil
    groupAnchors = [:]
    store = nil
  }
  deinit {
    clockTimer?.invalidate()
    for window in windows.values { window.close() }
    for window in retiring.values { window.close() }
  }
}

private final class ActiveReminderCardWindow: NSObject, NSWindowDelegate {
  let panel: NSPanel = ActiveReminderWindow(
    contentRect: .zero,
    styleMask: [.borderless, .nonactivatingPanel, .resizable], backing: .buffered, defer: false)
  private let cardID: String
  private let store: ActiveReminderStore?
  private let mouseButtons: () -> Int
  private let geometry: (NSScreen) -> PetGeometry
  private var signature = ""
  private var arrived = false
  private var dragCandidate: ActiveReminderSlot?
  private var resizeAnchor: Int?
  private var lastResizeFrame: CGRect?
  var attachedAnchor: Int?
  var occupied: () -> [String: CGRect] = { [:] }
  var layoutChanged: () -> Void = {}
  var feedback: (ActiveReminderFeedback) -> Void = { _ in }
  private let appearance = ActiveReminderAppearance()
  private let clock: ActiveReminderClock
  private var interacting = false
  private var guideGeneration = 0
  fileprivate var completeAction: () -> Void = {}
  fileprivate var openAction: () -> Void = {}
  var item: ActiveReminderCandidate?
  var interactions = ActiveReminderInteractions()
  var dragBegan: (() -> Void)?
  var dragMoved: ((CGPoint) -> Void)?
  var dragFinished: (() -> Void)?
  var menuFactory: (() -> NSMenu)?
  var toggleJoin: ((String, Bool) -> Void)?
  private var seamView: ActiveReminderSeamView?
  var canComplete = true
  fileprivate var hadPending = false
  fileprivate var lastCompletionError: String?
  let guides = ActiveReminderSlotView(frame: .zero)
  let guidePanel = ActiveReminderWindow(
    contentRect: .zero,
    styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
  var arranging = false
  private var settle: DispatchWorkItem?
  init(
    item: ActiveReminderCandidate, screen: NSScreen, occupied: [CGRect],
    store: ActiveReminderStore?, mouseButtons: @escaping () -> Int,
    geometry: @escaping (NSScreen) -> PetGeometry, clock: ActiveReminderClock
  ) {
    cardID = item.cardID
    self.store = store
    self.mouseButtons = mouseButtons
    self.geometry = geometry
    self.clock = clock
    super.init()
    panel.level = .floating
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
    panel.hidesOnDeactivate = false
    panel.isReleasedWhenClosed = false
    panel.isMovable = true
    panel.acceptsMouseMovedEvents = true
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = true
    panel.contentMinSize = NSSize(width: 240, height: 64)
    panel.maxSize = geometry(screen).bounds.size
    panel.delegate = self
    panel.setAccessibilityLabel("nohmi \(item.kind)")
    guidePanel.isOpaque = false
    guidePanel.backgroundColor = .clear
    guidePanel.hasShadow = false
    guidePanel.ignoresMouseEvents = true
    guidePanel.level = .floating
    guidePanel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
    guidePanel.hidesOnDeactivate = false
    guidePanel.isReleasedWhenClosed = false
    guidePanel.contentView = guides
    guides.wantsLayer = true
    let area = geometry(screen).bounds
    let frame: CGRect
    if let saved = store?.cardPlacement(card: cardID, display: PetDisplays.id(screen)) {
      let size = CGSize(width: max(240, saved.width), height: max(64, saved.height))
      frame = CGRect(
        x: area.minX + max(0, area.width - size.width) * saved.x,
        y: area.minY + max(0, area.height - size.height) * saved.y, width: size.width,
        height: size.height)
    } else {
      frame = ActiveReminderPlacement.unoccupied(in: geometry(screen), occupied: occupied)
    }
    arranging = true
    let fitted = ActiveReminderPlacement.fit(frame, geometry: geometry(screen))
    let taken = Dictionary(
      uniqueKeysWithValues: occupied.enumerated().map { (String($0.offset), $0.element) })
    let available =
      occupied.contains { ActiveReminderDocking.overlaps($0, fitted) }
      ? (ActiveReminderDocking.nearest(
        to: fitted,
        slots: ActiveReminderDocking.slots(
          size: fitted.size, geometry: geometry(screen), occupied: taken),
        radius: .greatestFiniteMagnitude)?.frame
        ?? ActiveReminderPlacement.unoccupied(in: geometry(screen), occupied: occupied)) : fitted
    panel.setFrame(available, display: false)
    arranging = false
    attachedAnchor = ActiveReminderPlacement.anchors(in: geometry(screen), size: panel.frame.size)
      .firstIndex { abs($0.minX - panel.frame.minX) < 1 && abs($0.minY - panel.frame.minY) < 1 }
  }
  func show(
    item: ActiveReminderCandidate, preview: Bool, pending: Bool, error: String?, stale: Bool,
    complete: @escaping () -> Void, open: @escaping () -> Void
  ) throws {
    completeAction = complete
    openAction = open
    canComplete = !pending && !stale
    if pending && !hadPending {
      feedback(.pending)
      pulse()
    }
    if error != nil && error != lastCompletionError {
      feedback(.failure)
      pulse(failure: true)
    }
    hadPending = pending
    lastCompletionError = error
    let next =
      "\(item.sourceRevision)|\(item.title)|\(item.dueAt)|\(preview)|\(pending)|\(error ?? "")|\(stale)"
    if signature != next && !interacting {
      let container = NSView(
        frame: CGRect(origin: .zero, size: panel.contentRect(forFrameRect: panel.frame).size))
      let hosting = NSHostingView(
        rootView: ActiveReminderCard(
          appearance: appearance, clock: clock, item: item, preview: preview,
          pending: pending, error: error, stale: stale, complete: complete, open: open))
      hosting.frame = container.bounds
      hosting.autoresizingMask = [.width, .height]
      container.wantsLayer = true
      container.addSubview(hosting)
      let header = ActiveReminderDragView(frame: container.bounds)
      header.autoresizingMask = [.width, .height]
      header.toolTip = "Drag anywhere to move this card"
      header.forwardScroll = { [weak hosting] event in
        guard let hosting, let container = hosting.superview else { return }
        let point = container.convert(event.locationInWindow, from: nil)
        (hosting.hitTest(point) ?? hosting).scrollWheel(with: event)
      }
      header.menuProvider = { [weak self] in self?.makeMenu() ?? NSMenu() }
      header.dragStarted = { [weak self] in
        guard let self else { return }
        self.interacting = true
        self.guideGeneration += 1
        self.feedback(self.appearance.seams.isJoined ? .detach : .grab)
        self.pulse()
        self.dragBegan?()
      }
      header.controlledDrag = dragMoved
      header.dragChanged = { [weak self] _ in if self?.dragMoved == nil { self?.updateAnchors() } }
      header.dragEnded = { [weak self] in
        guard let self else { return }
        self.interacting = false
        if let dragFinished = self.dragFinished { dragFinished() } else { self.finishDrag() }
      }
      header.clicked = { [weak self] point in
        guard let self, let content = self.panel.contentView else { return }
        let local = self.panel.convertPoint(fromScreen: point)
        let completionTarget = CGRect(
          x: 6, y: content.bounds.height - 32,
          width: 24, height: 24)
        if completionTarget.contains(local) {
          if self.canComplete { self.completeAction() }
        } else {
          self.feedback(.open)
          self.openAction()
        }
      }
      container.addSubview(header)
      let seams = ActiveReminderSeamView(frame: container.bounds)
      seams.autoresizingMask = [.width, .height]
      seams.toggle = { [weak self] peer, all in self?.toggleJoin?(peer, all) }
      container.addSubview(seams)
      seamView = seams
      let grip = ActiveReminderResizeView(
        frame: CGRect(x: container.bounds.width - 24, y: 0, width: 24, height: 24))
      grip.autoresizingMask = [.minXMargin, .maxYMargin]
      grip.toolTip = "Drag to resize this card"
      grip.menuProvider = { [weak self] in self?.makeMenu() ?? NSMenu() }
      grip.resizeBegan = { [weak self] in self?.beginResize() }
      grip.resizeChanged = { [weak self] in self?.fitDuringGesture() }
      grip.resizeEnded = { [weak self] in self?.finishResize() }
      grip.setAccessibilityElement(true)
      grip.setAccessibilityRole(.growArea)
      grip.setAccessibilityLabel("Resize \(item.kind)")
      container.addSubview(grip)
      for edge in [ActiveReminderResizeView.Edge.north, .south, .east, .west] {
        let strip = ActiveReminderResizeView(frame: .zero)
        strip.edge = edge
        switch edge {
        case .north:
          strip.frame = CGRect(
            x: 5, y: container.bounds.height - 5, width: container.bounds.width - 10, height: 5)
          strip.autoresizingMask = [.width, .minYMargin]
        case .south:
          strip.frame = CGRect(x: 5, y: 0, width: container.bounds.width - 30, height: 5)
          strip.autoresizingMask = [.width, .maxYMargin]
        case .east:
          strip.frame = CGRect(
            x: container.bounds.width - 5, y: 24, width: 5, height: container.bounds.height - 29)
          strip.autoresizingMask = [.height, .minXMargin]
        case .west:
          strip.frame = CGRect(x: 0, y: 5, width: 5, height: container.bounds.height - 10)
          strip.autoresizingMask = [.height, .maxXMargin]
        default: break
        }
        strip.resizeBegan = grip.resizeBegan
        strip.resizeChanged = grip.resizeChanged
        strip.resizeEnded = grip.resizeEnded
        strip.menuProvider = grip.menuProvider
        container.addSubview(strip, positioned: .below, relativeTo: seams)
      }
      panel.contentView = container
      signature = next
    }
    if mouseButtons() & 1 == 0, let screen = currentScreen() {
      panel.maxSize = geometry(screen).bounds.size
      arranging = true
      panel.setFrame(
        fittedFrame(on: screen),
        display: false)
      arranging = false
    }
    if !panel.isVisible { panel.orderFrontRegardless() }
    if !arrived {
      arrived = true
      animatePop(appearing: true)
    }
    guard panel.isVisible && panel.isOnActiveSpace else {
      throw NativeError.message("The active reminder card could not appear.")
    }
  }
  private func fittedFrame(on screen: NSScreen) -> CGRect {
    let layout = geometry(screen)
    let others = occupied()
    if let anchor = attachedAnchor {
      let target = ActiveReminderPlacement.anchors(in: layout, size: panel.frame.size)[anchor]
      if !others.values.contains(where: { ActiveReminderDocking.overlaps(target, $0) }) {
        return target
      }
      attachedAnchor = nil
    }
    let fitted = ActiveReminderPlacement.fit(panel.frame, geometry: layout)
    guard !others.values.contains(where: { ActiveReminderDocking.overlaps(fitted, $0) }) else {
      return ActiveReminderDocking.nearest(
        to: fitted,
        slots: ActiveReminderDocking.slots(size: fitted.size, geometry: layout, occupied: others),
        radius: .greatestFiniteMagnitude)?.frame
        ?? ActiveReminderPlacement.unoccupied(in: layout, occupied: Array(others.values))
    }
    return fitted
  }
  func currentScreen() -> NSScreen? {
    NSScreen.screens.first { $0.frame.contains(CGPoint(x: panel.frame.midX, y: panel.frame.midY)) }
      ?? NSScreen.screens.first { $0.frame.intersects(panel.frame) } ?? NSScreen.main
  }
  func popOut(_ completion: @escaping () -> Void) {
    guard panel.isVisible else {
      completion()
      return
    }
    guidePanel.orderOut(nil)
    animatePop(appearing: false)
    NSAnimationContext.runAnimationGroup(
      { context in
        context.duration = 0.18
        panel.animator().alphaValue = 0
      }, completionHandler: completion)
  }
  private func animatePop(appearing: Bool) {
    guard let layer = panel.contentView?.layer else { return }
    let opacity = CABasicAnimation(keyPath: "opacity")
    opacity.fromValue = appearing ? 0 : 1
    opacity.toValue = appearing ? 1 : 0
    opacity.duration = appearing ? 0.25 : 0.18
    layer.add(opacity, forKey: "reminder-opacity")
    guard !reduceMotion else { return }
    let scale = CAKeyframeAnimation(keyPath: "transform.scale")
    scale.values = appearing ? [0.88, 1.025, 1] : [1, 1.035, 0.82]
    scale.keyTimes = [0, 0.65, 1]
    scale.duration = appearing ? 0.3 : 0.18
    scale.timingFunction = CAMediaTimingFunction(name: .easeOut)
    layer.add(scale, forKey: "reminder-pop")
  }
  private func fitDuringGesture() {
    guard let screen = currentScreen() else { return }
    arranging = true
    let fitted = ActiveReminderPlacement.fit(panel.frame, geometry: geometry(screen))
    if !occupied().values.contains(where: { ActiveReminderDocking.overlaps(fitted, $0) }) {
      panel.setFrame(fitted, display: true)
      lastResizeFrame = fitted
    } else if let lastResizeFrame {
      panel.setFrame(lastResizeFrame, display: true)
    }
    arranging = false
  }
  private func availableSlots(on screen: NSScreen) -> [ActiveReminderSlot] {
    ActiveReminderDocking.slots(
      size: panel.frame.size, geometry: geometry(screen), occupied: occupied())
  }
  private func updateAnchors() {
    attachedAnchor = nil
    fitDuringGesture()
    guard let screen = currentScreen() else { return }
    let area = geometry(screen).bounds
    let slots = availableSlots(on: screen)
    let next = ActiveReminderDocking.nearest(to: panel.frame, slots: slots)
    if next?.frame != dragCandidate?.frame, next != nil { feedback(.slot) }
    dragCandidate = next
    guidePanel.setFrame(area, display: false)
    guides.slots = slots.map { $0.frame.offsetBy(dx: -area.minX, dy: -area.minY) }
    guides.candidate = next?.frame.offsetBy(dx: -area.minX, dy: -area.minY)
    if !guidePanel.isVisible {
      guideGeneration += 1
      guidePanel.alphaValue = 0
      guidePanel.order(.below, relativeTo: panel.windowNumber)
    }
    NSAnimationContext.runAnimationGroup { context in
      context.duration = 0.08
      guidePanel.animator().alphaValue = 1
    }
  }
  private func hideGuides(animated: Bool) {
    guideGeneration += 1
    let generation = guideGeneration
    guard animated && guidePanel.isVisible else {
      guidePanel.orderOut(nil)
      return
    }
    NSAnimationContext.runAnimationGroup(
      { context in
        context.duration = 0.08
        guidePanel.animator().alphaValue = 0
      },
      completionHandler: { [weak self] in
        guard let self, self.guideGeneration == generation else { return }
        self.guidePanel.orderOut(nil)
      })
  }
  private func finishDrag() {
    interacting = false
    hideGuides(animated: true)
    if let screen = currentScreen() {
      let slot = ActiveReminderDocking.nearest(to: panel.frame, slots: availableSlots(on: screen))
      attachedAnchor = slot?.anchor
      arranging = true
      panel.setFrame(slot?.frame ?? fittedFrame(on: screen), display: true)
      arranging = false
      feedback(slot == nil ? .release : slot?.neighbor == nil ? .snap : .dock)
      pulse()
    }
    dragCandidate = nil
    layoutChanged()
    scheduleSave()
  }
  func updateSeams(
    _ seams: ActiveReminderSeams, occupied: [String: CGRect] = [:],
    locks: Set<ActiveReminderEdge> = []
  ) {
    seamView?.update(
      frame: panel.frame, occupied: occupied, locks: locks, id: cardID, reduced: reduceMotion)
    guard appearance.seams != seams else { return }
    appearance.seams = seams
    panel.hasShadow = !seams.isJoined
  }
  private var reduceMotion: Bool {
    interactions.reducedMotion || NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
  }
  private func pulse(failure: Bool = false) {
    guard let layer = panel.contentView?.layer,
      !reduceMotion
    else { return }
    let effect = CAKeyframeAnimation(
      keyPath: failure ? "transform.translation.x" : "transform.scale")
    effect.values = failure ? [0, -3, 3, -2, 0] : [1, 0.985, 1]
    effect.duration = failure ? 0.16 : 0.12
    layer.add(effect, forKey: "reminder-feedback")
  }
  private func makeMenu() -> NSMenu {
    if let menuFactory { return menuFactory() }
    feedback(.menu)
    let menu = NSMenu()
    menu.autoenablesItems = false
    let complete = NSMenuItem(
      title: hadPending
        ? "Completing…"
        : lastCompletionError == nil
          ? "Complete" : "Retry completion", action: #selector(menuComplete), keyEquivalent: "")
    complete.target = self
    complete.isEnabled = canComplete
    menu.addItem(complete)
    let open = NSMenuItem(title: "View in nohmi", action: #selector(menuOpen), keyEquivalent: "")
    open.target = self
    menu.addItem(open)
    if appearance.seams.isJoined {
      menu.addItem(.separator())
      let separate = NSMenuItem(
        title: "Separate card", action: #selector(menuSeparate), keyEquivalent: "")
      separate.target = self
      menu.addItem(separate)
    }
    return menu
  }
  @objc private func menuComplete() { if canComplete { completeAction() } }
  @objc private func menuOpen() {
    feedback(.open)
    openAction()
  }
  @objc func menuSeparate() {
    guard let screen = currentScreen() else { return }
    attachedAnchor = nil
    let layout = geometry(screen)
    let others = occupied()
    var frames: [CGRect] = []
    for distance in stride(
      from: CGFloat(24), through: max(layout.bounds.width, layout.bounds.height), by: 24)
    {
      for offset in [
        CGPoint(x: distance, y: 0), CGPoint(x: -distance, y: 0), CGPoint(x: 0, y: -distance),
        CGPoint(x: 0, y: distance),
      ] {
        let frame = layout.fitCard(panel.frame.offsetBy(dx: offset.x, dy: offset.y))
        if !others.values.contains(where: { ActiveReminderDocking.overlaps(frame, $0) })
          && !ActiveReminderDocking.seams(frame: frame, occupied: others).isJoined
        {
          frames.append(frame)
        }
      }
      if !frames.isEmpty { break }
    }
    guard
      let target = frames.min(by: {
        hypot($0.minX - panel.frame.minX, $0.minY - panel.frame.minY)
          < hypot($1.minX - panel.frame.minX, $1.minY - panel.frame.minY)
      })
    else {
      feedback(.failure)
      return
    }
    panel.setFrame(target, display: true)
    feedback(.detach)
    pulse()
    layoutChanged()
    scheduleSave()
  }
  func hide() {
    interacting = false
    hideGuides(animated: false)
    dragCandidate = nil
    panel.orderOut(nil)
  }
  func close() {
    guideGeneration += 1
    guidePanel.close()
    settle?.cancel()
    panel.delegate = nil
    panel.close()
  }
  private func beginResize() {
    hideGuides(animated: false)
    interacting = true
    lastResizeFrame = panel.frame
    feedback(.resize)
    pulse()
    guard let screen = currentScreen() else { return }
    let frames = ActiveReminderPlacement.anchors(in: geometry(screen), size: panel.frame.size)
    resizeAnchor =
      attachedAnchor
      ?? frames.firstIndex {
        abs($0.minX - panel.frame.minX) < 1
          && abs($0.minY - panel.frame.minY) < 1
      }
  }
  private func finishResize() {
    interacting = false
    attachedAnchor = resizeAnchor
    if let screen = currentScreen() {
      arranging = true
      panel.setFrame(fittedFrame(on: screen), display: true)
      arranging = false
    }
    resizeAnchor = nil
    feedback(.release)
    pulse()
    layoutChanged()
    scheduleSave()
  }
  func windowWillStartLiveResize(_ notification: Notification) { beginResize() }
  func windowDidEndLiveResize(_ notification: Notification) { finishResize() }
  func windowDidMove(_ notification: Notification) {
    layoutChanged()
    scheduleSave()
  }
  func windowDidResize(_ notification: Notification) {
    layoutChanged()
    scheduleSave()
  }
  func scheduleSave() {
    guard !arranging else { return }
    settle?.cancel()
    let work = DispatchWorkItem { [weak self] in self?.saveGeometry() }
    settle = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2, execute: work)
  }
  private func saveGeometry() {
    if mouseButtons() & 1 != 0 {
      scheduleSave()
      return
    }
    guard let screen = currentScreen() else { return }
    let area = geometry(screen).bounds
    arranging = true
    panel.setFrame(
      fittedFrame(on: screen), display: true)
    arranging = false
    do {
      try store?.saveCardPlacement(
        card: cardID, display: PetDisplays.id(screen),
        geometry: ActiveReminderCardGeometry(
          x: (panel.frame.minX - area.minX) / max(1, area.width - panel.frame.width),
          y: (panel.frame.minY - area.minY) / max(1, area.height - panel.frame.height),
          width: panel.frame.width, height: panel.frame.height))
    } catch {
      // Geometry failure must not retire an incomplete card.
    }
  }
}

private final class ActiveReminderMenuItem: NSMenuItem {
  var run: (() -> Void)?
  init(_ title: String, run: @escaping () -> Void) {
    super.init(title: title, action: #selector(invoke), keyEquivalent: "")
    self.run = run
    target = self
  }
  required init(coder: NSCoder) { fatalError("init(coder:) is unsupported") }
  @objc private func invoke() { if isEnabled { run?() } }
}

extension ActiveReminderPanelController {
  var visibleFrames: [String: CGRect] {
    windows.filter { $0.value.panel.isVisible }.mapValues { $0.panel.frame }
  }
  func component(_ id: String, geometric: Bool = false) -> Set<String> {
    let edges = ActiveReminderGrouping.edges(visibleFrames)
    return ActiveReminderGrouping.component(
      id, edges: geometric ? edges : edges.intersection(locks))
  }
  func toggleJoin(_ id: String, peer: String, all: Bool) {
    let edge = ActiveReminderEdge(id, peer)
    let geometric = ActiveReminderGrouping.edges(visibleFrames)
    guard geometric.contains(edge) else { return }
    let targets = all ? geometric.filter { component(id, geometric: true).contains($0.a) } : [edge]
    let unlocking = locks.contains(edge)
    if unlocking { locks.subtract(targets) } else { locks.formUnion(targets) }
    play(unlocking ? .unlock : .lock)
    updateConnections()
  }
  private func layout(for frames: [String: CGRect]) -> PetGeometry? {
    let box = ActiveReminderGrouping.bounds(frames)
    guard
      let screen = NSScreen.screens.first(where: {
        $0.frame.contains(CGPoint(x: box.midX, y: box.midY))
      }) ?? NSScreen.main
    else { return nil }
    return geometry(screen)
  }
  private func apply(_ frames: [String: CGRect], save: Bool = false) {
    updatingGroup = true
    for (id, frame) in frames {
      guard let window = windows[id] else { continue }
      window.arranging = true
      window.attachedAnchor = nil
      window.panel.setFrame(frame, display: true)
      window.arranging = false
      if save { window.scheduleSave() }
    }
    updatingGroup = false
    updateConnections()
  }
  private func groupKey(_ ids: Set<String>) -> String { ids.sorted().joined(separator: "|") }
  private func refitGroups() {
    guard gesture == nil, mouseButtons() & 1 == 0 else { return }
    var visited = Set<String>()
    for id in visibleFrames.keys.sorted() where !visited.contains(id) {
      let ids = component(id)
      visited.formUnion(ids)
      guard ids.count > 1 else { continue }
      let frames = visibleFrames.filter { ids.contains($0.key) }
      guard let layout = layout(for: frames) else { continue }
      let box = ActiveReminderGrouping.bounds(frames)
      let target: CGRect
      if let anchor = groupAnchors[groupKey(ids)] {
        target = ActiveReminderPlacement.anchors(in: layout, size: box.size)[anchor]
      } else {
        target = layout.fitCard(box)
      }
      let next = ActiveReminderGrouping.translated(
        frames, dx: target.minX - box.minX, dy: target.minY - box.minY)
      if ActiveReminderGrouping.valid(
        next, geometry: layout, occupied: visibleFrames.filter({ !ids.contains($0.key) }))
      {
        apply(next)
      }
    }
  }
  private func groupSlots(_ frames: [String: CGRect], layout: PetGeometry) -> [ActiveReminderSlot] {
    let occupied = visibleFrames.filter { frames[$0.key] == nil }
    return ActiveReminderDocking.slots(
      size: ActiveReminderGrouping.bounds(frames).size,
      geometry: layout, occupied: occupied)
  }
  private func beginGroupDrag(_ id: String) {
    let frames = visibleFrames.filter { component(id).contains($0.key) }
    groupAnchors[groupKey(Set(frames.keys))] = nil
    gesture = GroupGesture(
      id: id, origin: NSEvent.mouseLocation, frames: frames,
      shake: PetShoo(sensitivity: interactions.sensitivity))
    // Drag tests and event synthesis need the same pointer used by the receiving surface.
    if let surface = windows[id]?.panel.contentView?.subviews.compactMap({
      $0 as? ActiveReminderDragView
    }).first {
      gesture?.origin = surface.dragOrigin ?? NSEvent.mouseLocation
    }
  }
  private func moveGroupDrag(_ point: CGPoint) {
    guard var drag = gesture, let layout = layout(for: drag.frames) else { return }
    let old = ActiveReminderGrouping.bounds(drag.frames)
    let target = layout.fitCard(
      old.offsetBy(dx: point.x - drag.origin.x, dy: point.y - drag.origin.y))
    var frames = ActiveReminderGrouping.translated(
      drag.frames, dx: target.minX - old.minX, dy: target.minY - old.minY)
    let others = visibleFrames.filter { drag.frames[$0.key] == nil }
    if ActiveReminderGrouping.valid(frames, geometry: layout, occupied: others) {
      apply(frames)
    } else {
      frames = visibleFrames.filter { drag.frames[$0.key] != nil }
    }
    if interactions.shake && !drag.gathered
      && drag.shake.update(
        point: point,
        time: ProcessInfo.processInfo.systemUptime, eligible: true, overArtwork: true,
        region: CGRect(x: -100000, y: -100000, width: 200000, height: 200000))
    {
      if gather(drag.id) {
        drag.gathered = true
        drag.origin = point
        drag.frames = visibleFrames
        frames = drag.frames
      }
    }
    let slots = groupSlots(frames, layout: layout)
    let candidate =
      interactions.snapping ? ActiveReminderGrouping.candidate(frames, slots: slots) : nil
    if candidate?.frame != drag.candidate?.frame, candidate != nil { play(.slot) }
    drag.candidate = candidate
    gesture = drag
    guard let window = windows[drag.id] else { return }
    if interactions.snapping && interactions.guides {
      let area = layout.bounds
      window.guidePanel.setFrame(area, display: false)
      let suggestions = ActiveReminderGrouping.guideSlots(
        slots, frame: ActiveReminderGrouping.bounds(frames), selected: candidate)
      window.guides.slots = suggestions.map { $0.frame.offsetBy(dx: -area.minX, dy: -area.minY) }
      window.guides.candidate = candidate?.frame.offsetBy(dx: -area.minX, dy: -area.minY)
      window.guides.occupied = others.mapValues { $0.offsetBy(dx: -area.minX, dy: -area.minY) }
      window.guides.members = frames.mapValues {
        $0.offsetBy(
          dx: -ActiveReminderGrouping.bounds(frames).minX,
          dy: -ActiveReminderGrouping.bounds(frames).minY)
      }
      window.guidePanel.alphaValue = 1
      window.guidePanel.order(.below, relativeTo: window.panel.windowNumber)
    }
  }
  private func endGroupDrag() {
    guard let drag = gesture else { return }
    gesture = nil
    windows[drag.id]?.guidePanel.orderOut(nil)
    var frames = visibleFrames.filter { drag.frames[$0.key] != nil }
    if let candidate = drag.candidate, let layout = layout(for: frames) {
      let box = ActiveReminderGrouping.bounds(frames)
      let snapped = ActiveReminderGrouping.translated(
        frames, dx: candidate.frame.minX - box.minX, dy: candidate.frame.minY - box.minY)
      if ActiveReminderGrouping.valid(
        snapped, geometry: layout, occupied: visibleFrames.filter({ frames[$0.key] == nil }))
      {
        frames = snapped
      }
    }
    apply(frames, save: true)
    if let anchor = drag.candidate?.anchor { groupAnchors[groupKey(Set(frames.keys))] = anchor }
    if interactions.autoLock {
      locks.formUnion(
        ActiveReminderGrouping.edges(visibleFrames).filter {
          frames[$0.a] != nil || frames[$0.b] != nil
        })
    }
    // Single anchored cards retain the exact target as Dock geometry changes.
    if frames.count == 1, let anchor = drag.candidate?.anchor {
      windows[drag.id]?.attachedAnchor = anchor
    }
    play(drag.candidate == nil ? .release : drag.candidate?.neighbor == nil ? .snap : .dock)
    updateConnections()
  }
  @discardableResult
  func gather(_ first: String) -> Bool {
    let frames = visibleFrames
    guard let firstFrame = frames[first], let layout = layout(for: frames),
      let stack = ActiveReminderGrouping.stack(
        [first] + frames.keys.filter { $0 != first }.sorted(), near: firstFrame, geometry: layout)
    else {
      play(.failure)
      return false
    }
    locks = ActiveReminderGrouping.edges(stack)
    apply(stack, save: true)
    play(.gather)
    return true
  }
  func resetSizes(_ id: String, all: Bool) {
    let ids = component(id, geometric: true)
    let frames = visibleFrames.filter { ids.contains($0.key) }
    guard let layout = layout(for: frames),
      let next = ActiveReminderGrouping.reset(
        frames, targets: all ? ids : [id], geometry: layout,
        occupied: visibleFrames.filter({ !ids.contains($0.key) }))
    else {
      play(.failure)
      return
    }
    let retained = locks
    apply(next, save: true)
    locks = retained.intersection(ActiveReminderGrouping.edges(visibleFrames))
    for (key, frame) in next {
      windows[key]?.attachedAnchor = ActiveReminderPlacement.anchors(in: layout, size: frame.size)
        .firstIndex(where: { $0.equalTo(frame) })
    }
    play(.resize)
    updateConnections()
  }
  func moveToEdge(_ id: String, all: Bool) {
    let ids = component(id, geometric: all)
    let frames = visibleFrames.filter { ids.contains($0.key) }
    guard let layout = layout(for: frames) else { return }
    let box = ActiveReminderGrouping.bounds(frames)
    let slots = groupSlots(frames, layout: layout).filter { $0.anchor != nil }
    guard
      let nearest = ActiveReminderDocking.nearest(
        to: box, slots: slots, radius: .greatestFiniteMagnitude)
    else {
      play(.failure)
      return
    }
    apply(
      ActiveReminderGrouping.translated(
        frames, dx: nearest.frame.minX - box.minX, dy: nearest.frame.minY - box.minY), save: true)
    groupAnchors[groupKey(ids)] = nearest.anchor
    if frames.count == 1 { windows[id]?.attachedAnchor = nearest.anchor }
    play(.snap)
  }
  func separate(_ id: String, all: Bool) {
    if all {
      let ids = component(id, geometric: true)
      locks = locks.filter { !ids.contains($0.a) || !ids.contains($0.b) }
      updateConnections()
      play(.unlock)
      return
    }
    locks = locks.filter { !$0.contains(id) }
    windows[id]?.menuSeparate()
  }
  func menu(for id: String) -> NSMenu {
    play(.menu)
    let menu = NSMenu()
    menu.autoenablesItems = false
    var glyphIndex = 0
    let glyphs: [ActiveReminderGlyph.Kind] = [
      .complete, .open, .snooze, .separate, .edge, .reset, .gather, .settings,
    ]
    func add(
      _ title: String, group: String? = nil, enabled: Bool = true,
      _ command: @escaping (Bool) -> Void
    ) {
      let item = ActiveReminderMenuItem(title) { command(false) }
      item.image = ActiveReminderGlyph.image(glyphs[glyphIndex])
      glyphIndex += 1
      item.keyEquivalentModifierMask = []
      item.isEnabled = enabled
      menu.addItem(item)
      if let group {
        let alternate = ActiveReminderMenuItem(group) { command(true) }
        alternate.image =
          group == "Unlock this group" ? ActiveReminderGlyph.image(.unlock) : item.image
        alternate.isAlternate = true
        alternate.keyEquivalentModifierMask = [.shift]
        alternate.isEnabled = enabled
        menu.addItem(alternate)
      }
    }
    func targets(_ all: Bool) -> [ActiveReminderCardWindow] {
      let ids = all ? self.component(id, geometric: true) : [id]
      return ids.sorted().compactMap { self.windows[$0] }
    }
    let pending = windows[id]?.hadPending ?? false
    let title =
      pending
      ? "Completing…" : windows[id]?.lastCompletionError == nil ? "Complete" : "Retry completion"
    add(title, group: "Complete group", enabled: windows[id]?.canComplete ?? false) { all in
      for window in targets(all) where window.canComplete { window.completeAction() }
    }
    add("View in nohmi") { _ in self.windows[id]?.openAction() }
    add("Snooze 15m", group: "Snooze group 15m", enabled: !pending) { all in
      for window in targets(all) { if let item = window.item { self.snooze?(item) } }
    }
    menu.addItem(.separator())
    add("Separate this card", group: "Unlock this group") { self.separate(id, all: $0) }
    add("Move to edge", group: "Move group to edge") { self.moveToEdge(id, all: $0) }
    add("Reset to smallest", group: "Reset group to smallest") { self.resetSizes(id, all: $0) }
    menu.addItem(.separator())
    add("Gather all into stack") { _ in self.gather(id) }
    add("Active card settings") { _ in self.settings?() }
    return menu
  }
}
