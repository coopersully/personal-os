import AppKit
import SwiftUI

protocol ActiveReminderPresenting: AnyObject {
  var isVisible: Bool { get }
  func show(
    _ items: [ActiveReminderCandidate], selected: String?, preview: Bool,
    pending: Set<String>, error: String?, stale: Bool) throws
  func hide()
}
private final class ActiveReminderWindow: NSPanel {
  override var canBecomeKey: Bool { true }
  override var canBecomeMain: Bool { false }
}
final class ActiveReminderDragView: NSView {
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  var pointer: () -> CGPoint = { NSEvent.mouseLocation }
  private var origin: (CGPoint, CGRect)?
  override func mouseDown(with event: NSEvent) {
    if let window { origin = (pointer(), window.frame) }
  }
  override func mouseDragged(with event: NSEvent) {
    guard let (point, frame) = origin else { return }
    let current = pointer()
    window?.setFrameOrigin(
      CGPoint(x: frame.minX + current.x - point.x, y: frame.minY + current.y - point.y))
  }
  override func mouseUp(with event: NSEvent) { origin = nil }
}
private struct ActiveReminderDragArea: NSViewRepresentable {
  func makeNSView(context: Context) -> ActiveReminderDragView { ActiveReminderDragView() }
  func updateNSView(_ view: ActiveReminderDragView, context: Context) {}
}
private struct ActiveReminderCard: View {
  var item: ActiveReminderCandidate
  var count: Int
  var index: Int
  var preview: Bool
  var pending: Bool
  var error: String?
  var stale: Bool
  var complete: () -> Void
  var open: () -> Void
  var previous: () -> Void
  var next: () -> Void
  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack {
        Text(item.kind == "task" ? "Task" : "Reminder").font(.subheadline).foregroundStyle(
          .secondary)
        Spacer()
        Text("nohmi").font(.subheadline.weight(.medium))
      }
      .overlay(
        ActiveReminderDragArea().frame(maxWidth: .infinity, maxHeight: .infinity)
          .accessibilityHidden(true)
      )
      .help("Drag to move this reminder")
      Text(preview ? item.title : (item.kind == "task" ? "A task is due" : "A reminder is due"))
        .font(.title3.weight(.semibold)).lineLimit(3).fixedSize(horizontal: false, vertical: true)
      if let due = parseDate(item.dueAt) {
        (Text("Due ") + Text(due, format: .relative(presentation: .numeric))).font(.caption)
          .foregroundStyle(.secondary)
      }
      if let error {
        Text(error).font(.caption).foregroundStyle(.red).lineLimit(3)
      } else if stale {
        Text("Couldn’t refresh. Reconnect to check this item.").font(.caption).foregroundStyle(
          .secondary)
      }
      HStack {
        Button(
          pending ? "Completing…" : (error == nil ? "Mark complete" : "Try again"), action: complete
        )
        .buttonStyle(.plain)
        .padding(.horizontal, 12).padding(.vertical, 8)
        .foregroundStyle(Color(nsColor: .windowBackgroundColor))
        .background(Color.primary, in: RoundedRectangle(cornerRadius: 10))
        .opacity(pending || stale ? 0.55 : 1).disabled(pending || stale)
        Button("Open in nohmi", action: open).buttonStyle(.bordered)
      }
      if count > 1 {
        HStack {
          Button("Previous", action: previous).disabled(index == 0)
          Spacer()
          Text("\(index + 1) of \(count)").font(.caption).accessibilityLabel(
            "Active reminder \(index + 1) of \(count)")
          Spacer()
          Button("Next", action: next).disabled(index == count - 1)
        }.buttonStyle(.plain)
      }
    }
    .padding(22).frame(maxWidth: .infinity, alignment: .leading)
    .background(Color(nsColor: .windowBackgroundColor), in: RoundedRectangle(cornerRadius: 22))
    .overlay(
      RoundedRectangle(cornerRadius: 22).stroke(Color(nsColor: .separatorColor), lineWidth: 1)
    )
    .background {
      ZStack {
        if count > 2 {
          RoundedRectangle(cornerRadius: 22).fill(Color(nsColor: .controlBackgroundColor)).padding(
            .horizontal, 12
          ).offset(y: 12)
        }
        if count > 1 {
          RoundedRectangle(cornerRadius: 22).fill(Color(nsColor: .separatorColor)).padding(
            .horizontal, 6
          ).offset(y: 6)
        }
      }
    }
    .padding(.bottom, count > 1 ? 12 : 0)
    .fixedSize(horizontal: false, vertical: true)
    .padding(2)
  }
}
final class ActiveReminderPanelController: NSObject, ActiveReminderPresenting, NSWindowDelegate {
  let panel: NSPanel = ActiveReminderWindow(
    contentRect: CGRect(x: 0, y: 0, width: 390, height: 300),
    styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
  var complete: ((ActiveReminderCandidate) -> Void)?
  var open: ((ActiveReminderCandidate) -> Void)?
  var select: ((String) -> Void)?
  var store: ActiveReminderStore?
  private var displayID: String?
  private var signature = ""
  private var arranging = false
  private var settle: DispatchWorkItem?
  private let mouseButtons: () -> Int
  var lastError: String?
  var isVisible: Bool { panel.isVisible && panel.isOnActiveSpace }
  init(mouseButtons: @escaping () -> Int = { NSEvent.pressedMouseButtons }) {
    self.mouseButtons = mouseButtons
    super.init()
    panel.level = .floating
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
    panel.hidesOnDeactivate = false
    panel.isReleasedWhenClosed = false
    panel.isMovable = true
    panel.isMovableByWindowBackground = true
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = true
    panel.delegate = self
    panel.setAccessibilityLabel("nohmi active reminders")
  }
  private func id(_ screen: NSScreen) -> String { PetDisplays.id(screen) }
  func show(
    _ items: [ActiveReminderCandidate], selected: String?, preview: Bool, pending: Set<String>,
    error: String?, stale: Bool
  ) throws {
    guard !items.isEmpty,
      let screen = (displayID == nil ? nil : NSScreen.screens.first(where: {
        $0.frame.contains(CGPoint(x: panel.frame.midX, y: panel.frame.midY))
      })) ?? NSScreen.screens.first(where: { id($0) == displayID })
        ?? NSScreen.screens.first(where: { $0.frame.contains(NSEvent.mouseLocation) })
        ?? NSScreen.main
    else {
      hide()
      throw NativeError.message("No display is available for active reminders.")
    }
    let index = items.firstIndex { $0.id == selected } ?? 0
    let item = items[index]
    let nextSignature =
      items.map { "\($0.id):\($0.sourceRevision):\($0.title):\($0.dueAt)" }.joined(separator: "|")
      + "\(index)|\(preview)|\(pending.sorted())|\(error ?? "")|\(stale)"
    if signature != nextSignature {
      let hosting = NSHostingView(
        rootView: ActiveReminderCard(
          item: item, count: items.count, index: index,
          preview: preview, pending: pending.contains(item.id), error: error, stale: stale,
          complete: { [weak self] in self?.complete?(item) },
          open: { [weak self] in self?.open?(item) },
          previous: { [weak self] in if index > 0 { self?.select?(items[index - 1].id) } },
          next: { [weak self] in if index + 1 < items.count { self?.select?(items[index + 1].id) } }
        ).frame(width: 386))
      panel.contentView = hosting
      panel.setContentSize(
        NSSize(width: 390, height: max(160, min(480, hosting.fittingSize.height))))
      signature = nextSignature
    }
    if displayID == nil || mouseButtons() & 1 == 0 {
      arranging = true
      let screenID = id(screen)
      if displayID == nil {
        displayID = screenID
        let area = screen.visibleFrame
        let point = store?.placement(display: screenID) ?? ActiveReminderPoint(x: 0.5, y: 0.5)
        let frame = CGRect(
          x: area.minX + max(0, area.width - panel.frame.width) * point.x,
          y: area.minY + max(0, area.height - panel.frame.height) * point.y,
          width: panel.frame.width, height: panel.frame.height)
        panel.setFrame(ActiveReminderPlacement.fit(frame, in: area, snap: false), display: true)
      } else {
        displayID = screenID
        panel.setFrame(
          ActiveReminderPlacement.fit(panel.frame, in: screen.visibleFrame, snap: false),
          display: true)
      }
      arranging = false
    }
    if !panel.isVisible { panel.orderFrontRegardless() }
    guard panel.isVisible && panel.isOnActiveSpace else {
      throw NativeError.message("The active reminder card could not appear.")
    }
  }
  func hide() { panel.orderOut(nil) }
  func reset() {
    hide()
    displayID = nil
    signature = ""
    store = nil
    settle?.cancel()
  }
  func windowDidMove(_ notification: Notification) {
    guard !arranging else { return }
    settle?.cancel()
    let work = DispatchWorkItem { [weak self] in self?.savePosition() }
    settle = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2, execute: work)
  }
  private func savePosition() {
    if mouseButtons() & 1 != 0 {
      windowDidMove(Notification(name: NSWindow.didMoveNotification))
      return
    }
    guard
      let screen = NSScreen.screens.first(where: {
        $0.frame.contains(CGPoint(x: panel.frame.midX, y: panel.frame.midY))
      })
    else { return }
    let area = screen.visibleFrame
    arranging = true
    panel.setFrame(ActiveReminderPlacement.fit(panel.frame, in: area, snap: true), display: true)
    arranging = false
    displayID = id(screen)
    do {
      try store?.savePlacement(
        display: id(screen),
        point: ActiveReminderPoint(
          x: (panel.frame.minX - area.minX) / max(1, area.width - panel.frame.width),
          y: (panel.frame.minY - area.minY) / max(1, area.height - panel.frame.height)))
    } catch { lastError = "Active reminder position could not be saved." }
  }
}
