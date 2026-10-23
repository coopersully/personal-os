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
    window?.setFrameOrigin(
      CGPoint(x: frame.minX + current.x - point.x, y: frame.minY + current.y - point.y))
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
  override func resetCursorRects() { addCursorRect(bounds, cursor: .resizeLeftRight) }
  override func mouseDown(with event: NSEvent) {
    if let window {
      origin = (location(event), window.frame)
      resizeBegan?()
    }
  }
  override func mouseDragged(with event: NSEvent) {
    guard let window, let (point, frame) = origin else { return }
    let current = location(event)
    let width = max(
      window.contentMinSize.width, min(window.maxSize.width, frame.width + current.x - point.x))
    let height = max(
      window.contentMinSize.height, min(window.maxSize.height, frame.height - current.y + point.y))
    window.setFrame(
      CGRect(x: frame.minX, y: frame.maxY - height, width: width, height: height), display: true)
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
  var store: ActiveReminderStore?
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
    for (id, window) in windows {
      let occupied = Dictionary(
        uniqueKeysWithValues: windows.compactMap { key, other in
          key != id && other.panel.isVisible ? (key, other.panel.frame) : nil
        })
      window.updateSeams(ActiveReminderDocking.seams(frame: window.panel.frame, occupied: occupied))
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
        window.feedback = { [weak self] event in self?.play(event) }
        windows[item.cardID] = window
      }
      do {
        try window.show(
          item: item, preview: preview, pending: pending.contains(item.cardID),
          error: errors[item.cardID], stale: stale,
          complete: { [weak self] in self?.complete?(item) },
          open: { [weak self] in self?.open?(item) })
        if isNew && soundEnabled { feedback(.arrival) }
      } catch { failure = error }
    }
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
  private var attachedAnchor: Int?
  var occupied: () -> [String: CGRect] = { [:] }
  var layoutChanged: () -> Void = {}
  var feedback: (ActiveReminderFeedback) -> Void = { _ in }
  private let appearance = ActiveReminderAppearance()
  private let clock: ActiveReminderClock
  private var interacting = false
  private var guideGeneration = 0
  private var completeAction: () -> Void = {}
  private var openAction: () -> Void = {}
  private var canComplete = true
  private var hadPending = false
  private var lastCompletionError: String?
  private let guides = ActiveReminderSlotView(frame: .zero)
  private let guidePanel = ActiveReminderWindow(
    contentRect: .zero,
    styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
  private var arranging = false
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
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = true
    panel.contentMinSize = NSSize(width: 240, height: 72)
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
      let size = CGSize(width: max(240, saved.width), height: max(72, saved.height))
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
      }
      header.dragChanged = { [weak self] _ in self?.updateAnchors() }
      header.dragEnded = { [weak self] in self?.finishDrag() }
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
  private func currentScreen() -> NSScreen? {
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
    guard !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion else { return }
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
    panel.setFrame(
      ActiveReminderPlacement.fit(panel.frame, geometry: geometry(screen)), display: true)
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
  func updateSeams(_ seams: ActiveReminderSeams) {
    guard appearance.seams != seams else { return }
    appearance.seams = seams
    panel.hasShadow = !seams.isJoined
  }
  private func pulse(failure: Bool = false) {
    guard let layer = panel.contentView?.layer,
      !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    else { return }
    let effect = CAKeyframeAnimation(
      keyPath: failure ? "transform.translation.x" : "transform.scale")
    effect.values = failure ? [0, -3, 3, -2, 0] : [1, 0.985, 1]
    effect.duration = failure ? 0.16 : 0.12
    layer.add(effect, forKey: "reminder-feedback")
  }
  private func makeMenu() -> NSMenu {
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
  @objc private func menuSeparate() {
    guard let screen = currentScreen() else { return }
    attachedAnchor = nil
    let layout = geometry(screen)
    let others = occupied()
    let frames = [
      CGPoint(x: 24, y: 0), CGPoint(x: -24, y: 0), CGPoint(x: 0, y: -24), CGPoint(x: 0, y: 24),
    ]
    .map { layout.fitCard(panel.frame.offsetBy(dx: $0.x, dy: $0.y)) }
    let target =
      frames.first { frame in
        !others.values.contains { ActiveReminderDocking.overlaps(frame, $0) }
          && !ActiveReminderDocking.seams(frame: frame, occupied: others).isJoined
      } ?? ActiveReminderPlacement.unoccupied(in: layout, occupied: Array(others.values))
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
  private func scheduleSave() {
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
