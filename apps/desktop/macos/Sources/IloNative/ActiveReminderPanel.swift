import AppKit
import SwiftUI

protocol ActiveReminderPresenting: AnyObject {
  var isVisible: Bool { get }
  func show(
    _ items: [ActiveReminderCandidate], preview: Bool,
    pending: Set<String>, errors: [String: String], stale: Bool) throws
  func hide()
}
private final class ActiveReminderWindow: NSPanel {
  override var canBecomeKey: Bool { true }
  override var canBecomeMain: Bool { false }
}
final class ActiveReminderDragView: NSView {
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  var pointer: ((NSEvent) -> CGPoint)?
  private func location(_ event: NSEvent) -> CGPoint {
    pointer?(event) ?? window?.convertPoint(toScreen: event.locationInWindow)
      ?? NSEvent.mouseLocation
  }
  private var origin: (CGPoint, CGRect)?
  override func mouseDown(with event: NSEvent) {
    if let window { origin = (location(event), window.frame) }
  }
  override func mouseDragged(with event: NSEvent) {
    guard let (point, frame) = origin else { return }
    let current = location(event)
    window?.setFrameOrigin(
      CGPoint(x: frame.minX + current.x - point.x, y: frame.minY + current.y - point.y))
  }
  override func mouseUp(with event: NSEvent) { origin = nil }
}

final class ActiveReminderResizeView: NSView {
  var pointer: ((NSEvent) -> CGPoint)?
  private func location(_ event: NSEvent) -> CGPoint {
    pointer?(event) ?? window?.convertPoint(toScreen: event.locationInWindow)
      ?? NSEvent.mouseLocation
  }
  private var origin: (CGPoint, CGRect)?
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  override func resetCursorRects() { addCursorRect(bounds, cursor: .crosshair) }
  override func mouseDown(with event: NSEvent) {
    if let window { origin = (location(event), window.frame) }
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
  }
  override func mouseUp(with event: NSEvent) { origin = nil }
  override func draw(_ dirtyRect: NSRect) {
    NSColor.tertiaryLabelColor.setStroke()
    for offset in [4.0, 8.0, 12.0, 20.0] {
      let path = NSBezierPath()
      path.move(to: CGPoint(x: bounds.maxX - offset, y: bounds.minY + 2))
      path.line(to: CGPoint(x: bounds.maxX - 2, y: bounds.minY + offset))
      path.stroke()
    }
  }
}

/// Native counterpart of TaskItem/ReminderItem's shared CommitmentItem grammar:
/// leading completion control, 15pt title, quiet due metadata and compact spacing.
private struct ActiveReminderCard: View {
  var item: ActiveReminderCandidate
  var preview: Bool
  var pending: Bool
  var error: String?
  var stale: Bool
  var complete: () -> Void
  var open: () -> Void
  var body: some View {
    VStack(spacing: 0) {
      HStack(spacing: 5) {
        Text(item.kind == "task" ? "Task" : "Reminder")
        Spacer()
        Text("nohmi")
      }
      .font(.system(size: 10)).foregroundStyle(.secondary)
      .padding(.horizontal, 12).frame(height: 20)
      .help("Drag to move")
      ScrollView {
        HStack(alignment: .top, spacing: 8) {
          Button(action: complete) {
            ZStack {
              RoundedRectangle(cornerRadius: 3).stroke(Color.secondary.opacity(0.65), lineWidth: 1)
                .frame(width: 16, height: 16)
              if pending { ProgressView().controlSize(.mini).scaleEffect(0.65) }
            }.frame(width: 24, height: 24)
          }
          .buttonStyle(.plain).disabled(pending || stale)
          .accessibilityLabel(
            pending
              ? "Completing"
              : (error == nil ? "Complete \(item.kind)" : "Retry completing \(item.kind)")
          )
          .help(error == nil ? "Mark complete" : "Try again")
          .keyboardShortcut(.return, modifiers: .command)
          VStack(alignment: .leading, spacing: 3) {
            Button(action: open) {
              Text(preview ? item.title : "A \(item.kind) is due")
                .font(.system(size: 15)).multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
            }.buttonStyle(.plain).help("Open \(item.kind) in nohmi")
            if let due = parseDate(item.dueAt) {
              (Text("Due ") + Text(due, format: .relative(presentation: .numeric)))
                .font(.system(size: 11)).foregroundStyle(.secondary)
            }
            if let error {
              Text(error).font(.system(size: 11)).foregroundStyle(.red)
                .fixedSize(horizontal: false, vertical: true)
            } else if stale {
              Text("Reconnect to update").font(.system(size: 11)).foregroundStyle(.secondary)
            }
          }
        }.padding(.leading, 7).padding(.trailing, 24).padding(.bottom, 10)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .background(Color(nsColor: .windowBackgroundColor), in: RoundedRectangle(cornerRadius: 7))

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
  var lastError: String?
  var isVisible: Bool {
    !windows.isEmpty && windows.values.allSatisfy { $0.panel.isVisible && $0.panel.isOnActiveSpace }
  }
  init(mouseButtons: @escaping () -> Int = { NSEvent.pressedMouseButtons }) {
    self.mouseButtons = mouseButtons
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
    guard !items.isEmpty else { return }
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
      if let existing = windows[item.cardID] {
        window = existing
      } else {
        let occupied = windows.values.map { $0.panel.frame }
        let savedScreen =
          NSScreen.screens.first { PetDisplays.id($0) == store?.cardDisplay(card: item.cardID) }
          ?? screen
        window = ActiveReminderCardWindow(
          item: item, screen: savedScreen, occupied: occupied,
          store: store, mouseButtons: mouseButtons)
        windows[item.cardID] = window
      }
      do {
        try window.show(
          item: item, preview: preview, pending: pending.contains(item.cardID),
          error: errors[item.cardID], stale: stale,
          complete: { [weak self] in self?.complete?(item) },
          open: { [weak self] in self?.open?(item) })
      } catch { failure = error }
    }
    if let failure { throw failure }
  }
  func hide() { for window in windows.values { window.panel.orderOut(nil) } }
  func reset() {
    for window in windows.values { window.close() }
    windows = [:]
    store = nil
  }
  deinit { for window in windows.values { window.close() } }
}

private final class ActiveReminderCardWindow: NSObject, NSWindowDelegate {
  let panel: NSPanel = ActiveReminderWindow(
    contentRect: .zero,
    styleMask: [.borderless, .nonactivatingPanel, .resizable], backing: .buffered, defer: false)
  private let cardID: String
  private let store: ActiveReminderStore?
  private let mouseButtons: () -> Int
  private var signature = ""
  private var arranging = false
  private var settle: DispatchWorkItem?
  init(
    item: ActiveReminderCandidate, screen: NSScreen, occupied: [CGRect],
    store: ActiveReminderStore?, mouseButtons: @escaping () -> Int
  ) {
    cardID = item.cardID
    self.store = store
    self.mouseButtons = mouseButtons
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
    panel.maxSize = screen.visibleFrame.size
    panel.delegate = self
    panel.setAccessibilityLabel("nohmi \(item.kind)")
    let area = screen.visibleFrame
    let frame: CGRect
    if let saved = store?.cardPlacement(card: cardID, display: PetDisplays.id(screen)) {
      let size = CGSize(width: max(240, saved.width), height: max(72, saved.height))
      frame = CGRect(
        x: area.minX + max(0, area.width - size.width) * saved.x,
        y: area.minY + max(0, area.height - size.height) * saved.y, width: size.width,
        height: size.height)
    } else {
      frame = ActiveReminderPlacement.unoccupied(in: area, occupied: occupied)
    }
    arranging = true
    panel.setFrame(ActiveReminderPlacement.fit(frame, in: area, snap: false), display: false)
    arranging = false
  }
  func show(
    item: ActiveReminderCandidate, preview: Bool, pending: Bool, error: String?, stale: Bool,
    complete: @escaping () -> Void, open: @escaping () -> Void
  ) throws {
    let next =
      "\(item.sourceRevision)|\(item.title)|\(item.dueAt)|\(preview)|\(pending)|\(error ?? "")|\(stale)"
    if signature != next {
      let container = NSView(
        frame: CGRect(origin: .zero, size: panel.contentRect(forFrameRect: panel.frame).size))
      let hosting = NSHostingView(
        rootView: ActiveReminderCard(
          item: item, preview: preview,
          pending: pending, error: error, stale: stale, complete: complete, open: open))
      hosting.frame = container.bounds
      hosting.autoresizingMask = [.width, .height]
      container.addSubview(hosting)
      let header = ActiveReminderDragView(
        frame: CGRect(
          x: 0, y: container.bounds.height - 20,
          width: container.bounds.width, height: 20))
      header.autoresizingMask = [.width, .minYMargin]
      header.toolTip = "Drag to move this card"
      container.addSubview(header)
      let grip = ActiveReminderResizeView(
        frame: CGRect(x: container.bounds.width - 24, y: 0, width: 24, height: 24))
      grip.autoresizingMask = [.minXMargin, .maxYMargin]
      grip.toolTip = "Drag to resize this card"
      grip.setAccessibilityElement(true)
      grip.setAccessibilityRole(.growArea)
      grip.setAccessibilityLabel("Resize \(item.kind)")
      container.addSubview(grip)
      panel.contentView = container
      signature = next
    }
    if mouseButtons() & 1 == 0, let screen = currentScreen() {
      panel.maxSize = screen.visibleFrame.size
      arranging = true
      panel.setFrame(
        ActiveReminderPlacement.fit(panel.frame, in: screen.visibleFrame, snap: false),
        display: false)
      arranging = false
    }
    if !panel.isVisible { panel.orderFrontRegardless() }
    guard panel.isVisible && panel.isOnActiveSpace else {
      throw NativeError.message("The active reminder card could not appear.")
    }
  }
  private func currentScreen() -> NSScreen? {
    NSScreen.screens.first { $0.frame.contains(CGPoint(x: panel.frame.midX, y: panel.frame.midY)) }
      ?? NSScreen.screens.first { $0.frame.intersects(panel.frame) } ?? NSScreen.main
  }
  func close() {
    settle?.cancel()
    panel.delegate = nil
    panel.close()
  }
  func windowDidMove(_ notification: Notification) { scheduleSave() }
  func windowDidResize(_ notification: Notification) { scheduleSave() }
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
    let area = screen.visibleFrame
    arranging = true
    panel.setFrame(ActiveReminderPlacement.fit(panel.frame, in: area, snap: true), display: true)
    arranging = false
    do {
      try store?.saveCardPlacement(
        card: cardID, display: PetDisplays.id(screen),
        geometry: ActiveReminderCardGeometry(
          x: (panel.frame.minX - area.minX) / max(1, area.width - panel.frame.width),
          y: (panel.frame.minY - area.minY) / max(1, area.height - panel.frame.height),
          width: panel.frame.width, height: panel.frame.height))
    } catch { /* Geometry failure must not retire an incomplete card. */  }
  }
}
