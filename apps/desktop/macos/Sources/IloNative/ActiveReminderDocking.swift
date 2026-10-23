import AppKit

struct ActiveReminderSlot: Equatable {
  var frame: CGRect
  var anchor: Int?
  var neighbor: String?
}
struct ActiveReminderCorners: OptionSet, Equatable {
  let rawValue: Int
  static let topLeft = Self(rawValue: 1)
  static let topRight = Self(rawValue: 2)
  static let bottomLeft = Self(rawValue: 4)
  static let bottomRight = Self(rawValue: 8)
}
struct ActiveReminderSeams: Equatable {
  var corners: ActiveReminderCorners = []
  // Local top-left coordinates, ready for the SwiftUI overlay.
  var dividers: [CGRect] = []
  var sharedEdges: [CGRect] = []
  var isJoined = false
}

enum ActiveReminderDocking {
  static func overlaps(_ a: CGRect, _ b: CGRect) -> Bool {
    let intersection = a.intersection(b)
    return !intersection.isNull && intersection.width > 0.5 && intersection.height > 0.5
  }
  static func slots(size: CGSize, geometry: PetGeometry, occupied: [String: CGRect])
    -> [ActiveReminderSlot]
  {
    var result: [ActiveReminderSlot] = []
    func append(_ frame: CGRect, anchor: Int? = nil, neighbor: String? = nil) {
      guard frame.size == size, !occupied.values.contains(where: { overlaps(frame, $0) }),
        geometry.fitCard(frame).equalTo(frame),
        !result.contains(where: { $0.frame.equalTo(frame) })
      else { return }
      result.append(ActiveReminderSlot(frame: frame, anchor: anchor, neighbor: neighbor))
    }
    // Neighbor slots win ties and retain their identity even when coincident with a screen anchor.
    for (id, other) in occupied.sorted(by: { $0.key < $1.key }) {
      for y in [other.maxY - size.height, other.minY, other.midY - size.height / 2] {
        append(CGRect(x: other.maxX, y: y, width: size.width, height: size.height), neighbor: id)
        append(
          CGRect(x: other.minX - size.width, y: y, width: size.width, height: size.height),
          neighbor: id)
      }
      for x in [other.minX, other.maxX - size.width, other.midX - size.width / 2] {
        append(CGRect(x: x, y: other.maxY, width: size.width, height: size.height), neighbor: id)
        append(
          CGRect(x: x, y: other.minY - size.height, width: size.width, height: size.height),
          neighbor: id)
      }
    }
    for (index, frame) in ActiveReminderPlacement.anchors(in: geometry, size: size).enumerated() {
      append(frame, anchor: index)
    }
    return result
  }
  static func nearest(to frame: CGRect, slots: [ActiveReminderSlot], radius: CGFloat = 80)
    -> ActiveReminderSlot?
  {
    let eligible = slots.filter { slot in
      let limit = slot.neighbor == nil || radius > 80 ? radius : min(radius, 28)
      return hypot(slot.frame.midX - frame.midX, slot.frame.midY - frame.midY) <= limit
    }
    let closest = eligible.min { a, b in
      hypot(a.frame.midX - frame.midX, a.frame.midY - frame.midY)
        < hypot(b.frame.midX - frame.midX, b.frame.midY - frame.midY)
    }
    return closest
  }
  static func seams(frame: CGRect, occupied: [String: CGRect]) -> ActiveReminderSeams {
    var result = ActiveReminderSeams()
    for other in occupied.values {
      let bottom = max(frame.minY, other.minY)
      let top = min(frame.maxY, other.maxY)
      let left = max(frame.minX, other.minX)
      let right = min(frame.maxX, other.maxX)
      if top - bottom > 1 {
        if abs(frame.maxX - other.minX) < 0.75 {
          result.sharedEdges.append(
            CGRect(x: frame.width - 1, y: frame.maxY - top, width: 1, height: top - bottom))
          result.isJoined = true
          if abs(top - frame.maxY) < 0.75 { result.corners.insert(.topRight) }
          if abs(bottom - frame.minY) < 0.75 { result.corners.insert(.bottomRight) }
          result.dividers.append(
            CGRect(x: frame.width - 1, y: frame.maxY - top, width: 1, height: top - bottom))
        } else if abs(frame.minX - other.maxX) < 0.75 {
          result.sharedEdges.append(
            CGRect(x: 0, y: frame.maxY - top, width: 1, height: top - bottom))
          result.isJoined = true
          if abs(top - frame.maxY) < 0.75 { result.corners.insert(.topLeft) }
          if abs(bottom - frame.minY) < 0.75 { result.corners.insert(.bottomLeft) }
        }
      }
      if right - left > 1 {
        if abs(frame.minY - other.maxY) < 0.75 {
          result.sharedEdges.append(
            CGRect(x: left - frame.minX, y: frame.height - 1, width: right - left, height: 1))
          result.isJoined = true
          if abs(left - frame.minX) < 0.75 { result.corners.insert(.bottomLeft) }
          if abs(right - frame.maxX) < 0.75 { result.corners.insert(.bottomRight) }
          result.dividers.append(
            CGRect(x: left - frame.minX, y: frame.height - 1, width: right - left, height: 1))
        } else if abs(frame.maxY - other.minY) < 0.75 {
          result.sharedEdges.append(
            CGRect(x: left - frame.minX, y: 0, width: right - left, height: 1))
          result.isJoined = true
          if abs(left - frame.minX) < 0.75 { result.corners.insert(.topLeft) }
          if abs(right - frame.maxX) < 0.75 { result.corners.insert(.topRight) }
        }
      }
    }
    result.dividers.sort { $0.minX == $1.minX ? $0.minY < $1.minY : $0.minX < $1.minX }
    return result
  }
}

/// Guides show the destination footprint, never a dot or an occupied target.
final class ActiveReminderSlotView: NSView {
  var slots: [CGRect] = [] { didSet { if oldValue != slots { needsDisplay = true } } }
  var occupied: [String: CGRect] = [:]
  var members: [String: CGRect] = [:]
  var candidate: CGRect? { didSet { if oldValue != candidate { needsDisplay = true } } }
  override func hitTest(_ point: NSPoint) -> NSView? { nil }
  override func draw(_ dirtyRect: NSRect) {
    for rect in slots {
      let selected = rect == candidate
      let shapes = members.isEmpty ? ["single": CGRect(origin: .zero, size: rect.size)] : members
      let destinations = shapes.mapValues { $0.offsetBy(dx: rect.minX, dy: rect.minY) }
      for (id, destination) in destinations {
        let peers = occupied.merging(destinations.filter { $0.key != id }) { a, _ in a }
        let corners = ActiveReminderDocking.seams(frame: destination, occupied: peers).corners
        let path = activeReminderOutline(destination.insetBy(dx: 1, dy: 1), corners: corners)
        NSColor.windowBackgroundColor.withAlphaComponent(selected ? 0.34 : 0.045).setFill()
        path.fill()
        NSColor.white.withAlphaComponent(selected ? 0.85 : 0.13).setStroke()
        path.lineWidth = 1
        path.stroke()
      }
    }
  }
}

/// A seam belongs to its left/top card. The opposite outline is removed by the card renderer.
/// Only its ten-point strip accepts input; the rest remains the full card drag surface.
final class ActiveReminderSeamView: NSView {
  struct Join: Equatable {
    var peer: String
    var strip: CGRect
    var line: CGRect
    var locked: Bool
    var ownsDivider: Bool
  }
  var joins: [Join] = []
  var toggle: ((String, Bool) -> Void)?
  private var hovered: String?
  private var buttons: [String: ActiveReminderJoinButton] = [:]
  private var tracking: NSTrackingArea?
  private var reduced = false
  private var progress: [String: CGFloat] = [:]
  private var animation: Timer?
  deinit { animation?.invalidate() }
  override func hitTest(_ point: NSPoint) -> NSView? {
    let local = convert(point, from: superview)
    if let button = buttons.values.first(where: { $0.frame.contains(local) }) { return button }
    return joins.contains { $0.strip.contains(local) } ? self : nil
  }
  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let tracking { removeTrackingArea(tracking) }
    tracking = NSTrackingArea(
      rect: bounds, options: [.activeAlways, .mouseMoved, .mouseEnteredAndExited, .inVisibleRect],
      owner: self)
    addTrackingArea(tracking!)
  }
  override func mouseMoved(with event: NSEvent) {
    let point = convert(event.locationInWindow, from: nil)
    let next = joins.first {
      $0.strip.contains(point) || buttons[$0.peer]?.frame.contains(point) == true
    }?.peer
    if hovered != next {
      hovered = next
      for (peer, button) in buttons { button.hovered = peer == next }
      needsDisplay = true
    }
  }
  override func mouseExited(with event: NSEvent) {
    hovered = nil
    for button in buttons.values { button.hovered = false }
    needsDisplay = true
  }
  override func mouseDown(with event: NSEvent) {
    let point = convert(event.locationInWindow, from: nil)
    if let join = joins.first(where: { $0.strip.contains(point) }) {
      toggle?(join.peer, event.modifierFlags.contains(.shift))
    }
  }
  func update(
    frame: CGRect, occupied: [String: CGRect], locks: Set<ActiveReminderEdge>, id: String,
    reduced: Bool
  ) {
    let next = occupied.sorted(by: { $0.key < $1.key }).flatMap { peer, other -> [Join] in
      let seams = ActiveReminderDocking.seams(frame: frame, occupied: [peer: other])
      return seams.sharedEdges.map { local in
        let line = CGRect(
          x: local.minX, y: frame.height - local.maxY, width: local.width, height: local.height)
        let vertical = line.width < line.height
        let strip = vertical ? line.insetBy(dx: -5, dy: 0) : line.insetBy(dx: 0, dy: -5)
        return Join(
          peer: peer, strip: strip, line: line,
          locked: locks.contains(ActiveReminderEdge(id, peer)),
          ownsDivider: seams.dividers.contains(local)
        )
      }
    }
    guard next != joins || self.reduced != reduced else { return }
    self.reduced = reduced
    joins = next
    let peers = Set(joins.filter(\.ownsDivider).map(\.peer))
    for peer in Array(buttons.keys) where !peers.contains(peer) {
      buttons.removeValue(forKey: peer)?.removeFromSuperview()
    }
    for join in joins where join.ownsDivider {
      let button = buttons[join.peer] ?? ActiveReminderJoinButton()
      button.frame = CGRect(
        x: max(0, min(bounds.width - 18, join.line.midX - 9)),
        y: max(0, min(bounds.height - 18, join.line.midY - 9)), width: 18, height: 18)
      button.glyph = join.locked ? .lock : .unlock
      button.setAccessibilityLabel(join.locked ? "Unlock join" : "Lock join")
      button.toolTip =
        (join.locked ? "Unlock" : "Lock") + " join · Shift-click applies to all connected joins"
      button.run = { [weak self] in self?.toggle?(join.peer, NSEvent.modifierFlags.contains(.shift))
      }
      if button.superview == nil { addSubview(button) }
      buttons[join.peer] = button
    }
    animation?.invalidate()
    let start = Date()
    let initial = progress
    if reduced {
      progress = Dictionary(uniqueKeysWithValues: joins.map { ($0.peer, $0.locked ? 1 : 0) })
    } else {
      animation = Timer.scheduledTimer(withTimeInterval: 1 / 60, repeats: true) {
        [weak self] timer in
        guard let self else {
          timer.invalidate()
          return
        }
        let t = min(1, Date().timeIntervalSince(start) / 0.12)
        for join in self.joins {
          let from = initial[join.peer] ?? (join.locked ? 1 : 0)
          self.progress[join.peer] = from + ((join.locked ? 1 : 0) - from) * t
        }
        self.needsDisplay = true
        if t == 1 { timer.invalidate() }
      }
    }
    needsDisplay = true
  }
  override func draw(_ dirtyRect: NSRect) {
    for join in joins where join.ownsDivider {
      var rect = join.line
      let amount = 1 - (progress[join.peer] ?? (join.locked ? 1 : 0))
      if rect.width < rect.height {
        rect = rect.insetBy(dx: 0, dy: min(12, rect.height / 3) * amount)
      } else {
        rect = rect.insetBy(dx: min(12, rect.width / 3) * amount, dy: 0)
      }
      NSColor.separatorColor.setFill()
      rect.fill()

    }
  }
}

private final class ActiveReminderJoinButton: NSButton {
  var glyph = ActiveReminderGlyph.Kind.unlock
  var hovered = false { didSet { needsDisplay = true } }
  var run: (() -> Void)?
  init() {
    super.init(frame: .zero)
    isBordered = false
    focusRingType = .none
    target = self
    action = #selector(activate)
    setButtonType(.momentaryChange)
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) is unsupported") }
  override var acceptsFirstResponder: Bool { true }
  @objc private func activate() { run?() }
  override func becomeFirstResponder() -> Bool {
    needsDisplay = true
    return super.becomeFirstResponder()
  }
  override func resignFirstResponder() -> Bool {
    needsDisplay = true
    return super.resignFirstResponder()
  }
  override func draw(_ dirtyRect: NSRect) {
    guard hovered || window?.firstResponder === self else { return }
    NSColor.windowBackgroundColor.setFill()
    NSBezierPath(roundedRect: bounds, xRadius: 4, yRadius: 4).fill()
    ActiveReminderGlyph.draw(glyph, in: bounds.insetBy(dx: 3, dy: 3))
  }
}

/// Generated from the shared reicon registry by generate-active-card-native-icons.ts.
enum ActiveReminderGlyph {
  enum Kind: String {
    case complete, open, snooze, unlock, separate, edge, reset, gather, settings, lock
  }
  private static var cache: [String: NSImage] = [:]
  static func image(_ kind: Kind) -> NSImage? {
    if let image = cache[kind.rawValue] { return image }
    guard
      let url = Bundle.main.url(
        forResource: kind.rawValue, withExtension: "png", subdirectory: "card-icons"),
      let image = NSImage(contentsOf: url)
    else { return nil }
    image.size = NSSize(width: 14, height: 14)
    image.isTemplate = true
    cache[kind.rawValue] = image
    return image
  }
  static func draw(_ kind: Kind, in rect: CGRect) { image(kind)?.draw(in: rect) }
}

private func activeReminderOutline(_ r: CGRect, corners: ActiveReminderCorners) -> NSBezierPath {
  let p = NSBezierPath()
  let tl: CGFloat = corners.contains(.topLeft) ? 0 : 6
  let tr: CGFloat = corners.contains(.topRight) ? 0 : 6
  let bl: CGFloat = corners.contains(.bottomLeft) ? 0 : 6
  let br: CGFloat = corners.contains(.bottomRight) ? 0 : 6
  p.move(to: CGPoint(x: r.minX + bl, y: r.minY))
  p.line(to: CGPoint(x: r.maxX - br, y: r.minY))
  p.curve(
    to: CGPoint(x: r.maxX, y: r.minY + br), controlPoint1: CGPoint(x: r.maxX, y: r.minY),
    controlPoint2: CGPoint(x: r.maxX, y: r.minY))
  p.line(to: CGPoint(x: r.maxX, y: r.maxY - tr))
  p.curve(
    to: CGPoint(x: r.maxX - tr, y: r.maxY), controlPoint1: CGPoint(x: r.maxX, y: r.maxY),
    controlPoint2: CGPoint(x: r.maxX, y: r.maxY))
  p.line(to: CGPoint(x: r.minX + tl, y: r.maxY))
  p.curve(
    to: CGPoint(x: r.minX, y: r.maxY - tl), controlPoint1: CGPoint(x: r.minX, y: r.maxY),
    controlPoint2: CGPoint(x: r.minX, y: r.maxY))
  p.line(to: CGPoint(x: r.minX, y: r.minY + bl))
  p.curve(
    to: CGPoint(x: r.minX + bl, y: r.minY), controlPoint1: CGPoint(x: r.minX, y: r.minY),
    controlPoint2: CGPoint(x: r.minX, y: r.minY))
  p.close()
  return p
}
