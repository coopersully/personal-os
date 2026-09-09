import AppKit
import SwiftUI

final class QuickAccessModel: ObservableObject {
  @Published var snapshot: NativeSnapshot?
  @Published var workspaces = ["tasks", "reminders", "calendar"]
  @Published var pending = Set<String>()
  @Published var failure: String?
  var action: (([String: Any]) -> Void)?
  func complete(_ item: WorkItem, kind: String) {
    guard let s = snapshot, !s.stale else {
      failure = "Reconnect to nohmi before completing items."
      return
    }
    let key = "\(kind):\(item.id)"
    pending.insert(key)
    failure = nil
    action?([
      "action": "complete", "kind": kind, "id": item.id, "serverUrl": s.serverUrl,
      "accountId": s.accountId,
    ])
    DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self] in
      guard let self, self.pending.remove(key) != nil else { return }
      self.failure = "Completion has not been confirmed. Open nohmi to check or retry."
    }
  }
  func update(_ s: NativeSnapshot?) {
    snapshot = s
    pending = pending.filter { key in
      guard let s else { return false }
      let bits = key.split(separator: ":", maxSplits: 1).map(String.init)
      return bits.count == 2
        && (bits[0] == "task" ? s.tasks : s.reminders).contains { $0.id == bits[1] && $0.active }
    }
    if s == nil { failure = nil }
  }
}
struct QuickAccessView: View {
  @ObservedObject var model: QuickAccessModel
  func open(_ path: String) { model.action?(["action": "open", "path": path]) }
  @ViewBuilder func items(_ items: [WorkItem], kind: String, title: String) -> some View {
    if !items.isEmpty {
      Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
      ForEach(items) { item in
        HStack(alignment: .top) {
          Button {
            model.complete(item, kind: kind)
          } label: {
            Image(systemName: model.pending.contains("\(kind):\(item.id)") ? "clock" : "circle")
          }.buttonStyle(.plain).disabled(model.pending.contains("\(kind):\(item.id)"))
            .accessibilityLabel("Complete \(item.title)")
          Button(item.title) { open(kind == "task" ? "/tasks" : "/reminders") }.buttonStyle(.plain)
            .multilineTextAlignment(.leading)
          Spacer(minLength: 0)
        }
      }
    }
  }
  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        Text("Today").font(.title2.weight(.semibold))
        Spacer()
        Button {
          model.action?(["action": "refresh"])
        } label: {
          Image(systemName: "arrow.clockwise")
        }.accessibilityLabel("Refresh today")
        Button("Open nohmi") { open("/today") }
      }
      if let s = model.snapshot {
        Text(
          s.stale
            ? "Cached information · reconnect to update"
            : "Updated \((parseDate(s.generatedAt) ?? Date()).formatted(date: .omitted, time: .shortened))"
        ).font(.caption).foregroundStyle(.secondary)
        ScrollView {
          VStack(alignment: .leading, spacing: 10) {
            if model.workspaces.contains("tasks") {
              items(s.dueToday(s.tasks, now: Date()), kind: "task", title: "Tasks today")
              items(s.overdue(s.tasks, now: Date()), kind: "task", title: "Earlier overdue tasks")
            }
            if model.workspaces.contains("reminders") {
              items(
                s.dueToday(s.reminders, now: Date()), kind: "reminder", title: "Reminders today")
              items(
                s.overdue(s.reminders, now: Date()), kind: "reminder",
                title: "Earlier overdue reminders")
            }
            if model.workspaces.contains("calendar") {
              Text("Calendar").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
              ForEach(s.todayEvents(now: Date())) { event in
                HStack {
                  VStack(alignment: .leading) {
                    Button(event.title) { open("/calendar") }.buttonStyle(.plain)
                    Text(
                      event.allDay
                        ? "All day"
                        : (parseDate(event.startsAt)?.formatted(date: .omitted, time: .shortened)
                          ?? "")
                    ).font(.caption).foregroundStyle(.secondary)
                  }
                  Spacer()
                  if let url = validMeetingURL(event.conferenceUrl),
                    (parseDate(event.endsAt) ?? .distantPast) > Date()
                  {
                    Button("Join") {
                      model.action?([
                        "action": "join", "url": url.absoluteString, "serverUrl": s.serverUrl,
                        "accountId": s.accountId,
                      ])
                    }
                  }
                }
              }
            }
            if model.workspaces.contains("finances"), let summary = s.financeSummary {
              Text(summary).font(.callout)
            }
          }.frame(maxWidth: .infinity, alignment: .leading)
        }.frame(maxHeight: 340)
        if let failure = model.failure { Text(failure).font(.caption).foregroundStyle(.red) }
        HStack {
          ForEach(["task", "reminder", "event"], id: \.self) { kind in
            Button("Add \(kind)") { model.action?(["action": "capture", "kind": kind]) }
          }
        }.controlSize(.small)
        Divider()
        LazyVGrid(
          columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())],
          alignment: .leading
        ) {
          ForEach(model.workspaces, id: \.self) { workspace in
            Button(workspace.capitalized) { open("/" + workspace) }.buttonStyle(.link)
          }
        }
      } else {
        Text("Sign in to see your day.").foregroundStyle(.secondary)
        Button("Open nohmi") { open("/today") }
      }
    }.padding(16).frame(width: 360)
  }
}
final class PetPanel: NSPanel {
  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }
}
final class PetView: NSView {
  var click: (() -> Void)?
  var moved: (() -> Void)?
  var color = NSColor.systemTeal { didSet { needsDisplay = true } }
  private var origin: NSPoint?
  private var originalFrame: NSPoint?
  private var dragged = false
  private var hovering = false
  private var tick = 0
  private var timer: Timer?
  override init(frame: NSRect) {
    super.init(frame: frame)
    setAccessibilityElement(true)
    setAccessibilityRole(.button)
    setAccessibilityLabel("nohmi desktop pet. Open quick access")
    NotificationCenter.default.addObserver(
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
    timer?.invalidate()
    NotificationCenter.default.removeObserver(self)
    NSWorkspace.shared.notificationCenter.removeObserver(self)
  }
  override func viewDidMoveToWindow() { restartAnimation() }
  @objc func stopAnimation() {
    timer?.invalidate()
    timer = nil
  }
  @objc func restartAnimation() {
    stopAnimation()
    guard window != nil, !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion else {
      needsDisplay = true
      return
    }
    timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
      guard let self, self.window?.isVisible == true else { return }
      self.tick += 1
      self.needsDisplay = true
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
    needsDisplay = true
  }
  override func mouseExited(with event: NSEvent) {
    hovering = false
    needsDisplay = true
  }
  override func accessibilityPerformPress() -> Bool {
    click?()
    return true
  }
  override func mouseDown(with event: NSEvent) {
    origin = NSEvent.mouseLocation
    originalFrame = window?.frame.origin
    dragged = false
  }
  override func mouseDragged(with event: NSEvent) {
    guard let origin, let originalFrame else { return }
    let current = NSEvent.mouseLocation
    if hypot(current.x - origin.x, current.y - origin.y) > 4 { dragged = true }
    if dragged {
      window?.setFrameOrigin(
        NSPoint(
          x: originalFrame.x + current.x - origin.x, y: originalFrame.y + current.y - origin.y))
      needsDisplay = true
    }
  }
  override func mouseUp(with event: NSEvent) {
    if dragged { moved?() } else { click?() }
    origin = nil
    originalFrame = nil
    dragged = false
    needsDisplay = true
  }
  override func draw(_ dirtyRect: NSRect) {
    // Original bundled creature artwork drawn into a small native sprite; no web view or network animation.
    let reduced = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    let bob: CGFloat = reduced ? 0 : (tick % 8 < 4 ? 1 : 0)
    let body = NSBezierPath(
      roundedRect: NSRect(x: 13, y: 12 + bob, width: 46, height: hovering ? 43 : 40), xRadius: 19,
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
    NSBezierPath(ovalIn: NSRect(x: 13, y: 39 + bob, width: 14, height: 19)).fill()
    NSBezierPath(ovalIn: NSRect(x: 44, y: 39 + bob, width: 14, height: 19)).fill()
    NSColor.labelColor.withAlphaComponent(0.85).setFill()
    let blink = !reduced && tick % 24 == 0
    for x in [CGFloat(26), 44] {
      NSBezierPath(
        ovalIn: NSRect(x: x, y: 33 + bob, width: 4, height: blink ? 1 : (dragged ? 7 : 5))
      ).fill()
    }
    let mouth = NSBezierPath()
    mouth.move(to: NSPoint(x: 33, y: 27 + bob))
    mouth.curve(
      to: NSPoint(x: 40, y: 27 + bob), controlPoint1: NSPoint(x: 34, y: 23 + bob),
      controlPoint2: NSPoint(x: 39, y: 23 + bob))
    mouth.lineWidth = 1.5
    NSColor.labelColor.setStroke()
    mouth.stroke()
  }
}
final class PetController {
  let model = QuickAccessModel()
  private let panel = PetPanel(
    contentRect: NSRect(x: 0, y: 0, width: 72, height: 72),
    styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
  private let sprite = PetView(frame: NSRect(x: 0, y: 0, width: 72, height: 72))
  private let popover = NSPopover()
  private var monitor: Any?
  init() {
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = false
    panel.level = .floating
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
    panel.isMovableByWindowBackground = false
    panel.hidesOnDeactivate = false
    panel.contentView = sprite
    panel.isReleasedWhenClosed = false
    popover.behavior = .transient
    popover.contentViewController = NSHostingController(rootView: QuickAccessView(model: model))
    sprite.click = { [weak self] in self?.quickAccess() }
    sprite.moved = { [weak self] in self?.clampAndSave() }
    NotificationCenter.default.addObserver(
      forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main
    ) { [weak self] _ in self?.restorePosition() }
    monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
      if event.keyCode == 53, self?.popover.isShown == true {
        self?.popover.close()
        return nil
      }
      return event
    }
    restorePosition()
  }
  deinit { if let monitor { NSEvent.removeMonitor(monitor) } }
  func configure(_ s: NativeSettings) {
    model.workspaces = s.petWorkspaces.filter {
      ["tasks", "reminders", "calendar", "finances", "mail", "goals", "motives"].contains($0)
    }
    if let rgb = UInt32(
      s.petColor.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16),
      s.petColor.count == 7
    {
      sprite.color = NSColor(
        srgbRed: CGFloat((rgb >> 16) & 255) / 255, green: CGFloat((rgb >> 8) & 255) / 255,
        blue: CGFloat(rgb & 255) / 255, alpha: 1)
    }
    if s.petEnabled {
      panel.orderFrontRegardless()
      sprite.restartAnimation()
    } else {
      panel.orderOut(nil)
      sprite.stopAnimation()
      popover.close()
    }
  }
  func quickAccess() {
    model.action?(["action": "refresh"])
    if popover.isShown {
      popover.close()
      return
    }
    // Menu-bar quick access remains usable when the ambient pet is disabled.
    if !panel.isVisible {
      let menu = NSMenu()
      let view = NSHostingView(rootView: QuickAccessView(model: model))
      view.frame = NSRect(
        x: 0, y: 0, width: 392, height: min(580, max(220, view.fittingSize.height)))
      let item = NSMenuItem()
      item.view = view
      menu.addItem(item)
      menu.popUp(positioning: nil, at: NSEvent.mouseLocation, in: nil)
      return
    }
    popover.show(relativeTo: sprite.bounds, of: sprite, preferredEdge: .minY)
    popover.contentViewController?.view.window?.makeKey()
  }
  func resetPosition() {
    UserDefaults.standard.removeObject(forKey: "ilo.pet.position")
    restorePosition()
  }
  func restorePosition() {
    let saved = UserDefaults.standard.dictionary(forKey: "ilo.pet.position")
    let screen =
      NSScreen.screens.first {
        ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.stringValue
          == saved?["display"] as? String
      } ?? NSScreen.main ?? NSScreen.screens.first
    guard let screen else { return }
    let f = screen.visibleFrame
    let x = saved?["x"] as? Double ?? 0.9
    let y = saved?["y"] as? Double ?? 0.15
    panel.setFrameOrigin(
      NSPoint(
        x: f.minX + CGFloat(x) * max(0, f.width - 72),
        y: f.minY + CGFloat(y) * max(0, f.height - 72)))
    clampAndSave()
  }
  func clampAndSave() {
    guard
      let screen = NSScreen.screens.max(by: {
        $0.visibleFrame.intersection(panel.frame).size.width
          * $0.visibleFrame.intersection(panel.frame).size.height < $1.visibleFrame.intersection(
            panel.frame
          ).size.width * $1.visibleFrame.intersection(panel.frame).size.height
      })
    else { return }
    let f = screen.visibleFrame
    let point = Self.clamped(panel.frame.origin, to: f, size: panel.frame.size)
    panel.setFrameOrigin(point)
    UserDefaults.standard.set(
      [
        "display":
          (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?
          .stringValue ?? "", "x": Double((point.x - f.minX) / max(1, f.width - 72)),
        "y": Double((point.y - f.minY) / max(1, f.height - 72)),
      ], forKey: "ilo.pet.position")
  }
  static func clamped(_ point: NSPoint, to frame: NSRect, size: NSSize) -> NSPoint {
    NSPoint(
      x: min(max(point.x, frame.minX), max(frame.minX, frame.maxX - size.width)),
      y: min(max(point.y, frame.minY), max(frame.minY, frame.maxY - size.height)))
  }
}
