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
          result.isJoined = true
          if abs(top - frame.maxY) < 0.75 { result.corners.insert(.topRight) }
          if abs(bottom - frame.minY) < 0.75 { result.corners.insert(.bottomRight) }
          result.dividers.append(
            CGRect(x: frame.width - 1, y: frame.maxY - top, width: 1, height: top - bottom))
        } else if abs(frame.minX - other.maxX) < 0.75 {
          result.isJoined = true
          if abs(top - frame.maxY) < 0.75 { result.corners.insert(.topLeft) }
          if abs(bottom - frame.minY) < 0.75 { result.corners.insert(.bottomLeft) }
        }
      }
      if right - left > 1 {
        if abs(frame.minY - other.maxY) < 0.75 {
          result.isJoined = true
          if abs(left - frame.minX) < 0.75 { result.corners.insert(.bottomLeft) }
          if abs(right - frame.maxX) < 0.75 { result.corners.insert(.bottomRight) }
          result.dividers.append(
            CGRect(x: left - frame.minX, y: frame.height - 1, width: right - left, height: 1))
        } else if abs(frame.maxY - other.minY) < 0.75 {
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
  var candidate: CGRect? { didSet { if oldValue != candidate { needsDisplay = true } } }
  override func hitTest(_ point: NSPoint) -> NSView? { nil }
  override func draw(_ dirtyRect: NSRect) {
    for rect in slots {
      let selected = rect == candidate
      let path = NSBezierPath(roundedRect: rect.insetBy(dx: 1, dy: 1), xRadius: 6, yRadius: 6)
      NSColor.windowBackgroundColor.withAlphaComponent(selected ? 0.34 : 0.045).setFill()
      path.fill()
      NSColor.white.withAlphaComponent(selected ? 0.85 : 0.13).setStroke()
      path.lineWidth = selected ? 2 : 1
      path.stroke()
    }
  }
}
