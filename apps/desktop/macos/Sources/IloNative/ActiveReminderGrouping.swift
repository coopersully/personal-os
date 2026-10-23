import AppKit

/// Physical display selection stays separate from its safe card geometry (menu bar/Dock excluded).
struct ActiveReminderDisplay {
  var frame: CGRect
  var geometry: PetGeometry
  static func closest(to point: CGPoint, in displays: [Self]) -> Self? {
    if let containing = displays.first(where: { $0.frame.contains(point) }) { return containing }
    func distance(_ display: Self) -> CGFloat {
      let x = min(max(point.x, display.frame.minX), display.frame.maxX)
      let y = min(max(point.y, display.frame.minY), display.frame.maxY)
      return hypot(x - point.x, y - point.y)
    }
    return displays.min { distance($0) < distance($1) }
  }
}

struct ActiveReminderInteractions: Codable, Equatable {
  var shake = true
  var sensitivity = "medium"
  var snapping = true
  var guides = true
  var autoLock = false
  var sounds = true
  var volume = 0.35
  var reducedMotion = false
  var returnCards = true
}
struct ActiveReminderEdge: Hashable, Codable {
  let a: String
  let b: String
  init(_ a: String, _ b: String) {
    self.a = min(a, b)
    self.b = max(a, b)
  }
  func contains(_ id: String) -> Bool { a == id || b == id }
}
/// Geometry and pair locks are intentionally separate. An unlocked geometric neighbor never travels.
enum ActiveReminderGrouping {
  static let minimum = CGSize(width: 240, height: 64)
  static func bounds(_ frames: [String: CGRect]) -> CGRect {
    frames.values.reduce(CGRect.null) { $0.union($1) }
  }
  static func edges(_ frames: [String: CGRect]) -> Set<ActiveReminderEdge> {
    let ids = frames.keys.sorted()
    var result = Set<ActiveReminderEdge>()
    for (i, a) in ids.enumerated() {
      for b in ids.dropFirst(i + 1) {
        if ActiveReminderDocking.seams(frame: frames[a]!, occupied: [b: frames[b]!]).isJoined {
          result.insert(ActiveReminderEdge(a, b))
        }
      }
    }
    return result
  }
  static func component(_ id: String, edges: Set<ActiveReminderEdge>) -> Set<String> {
    var result: Set<String> = [id]
    var changed = true
    while changed {
      changed = false
      for edge in edges where result.contains(edge.a) || result.contains(edge.b) {
        if result.insert(edge.a).inserted { changed = true }
        if result.insert(edge.b).inserted { changed = true }
      }
    }
    return result
  }
  static func translated(_ frames: [String: CGRect], dx: CGFloat, dy: CGFloat) -> [String: CGRect] {
    frames.mapValues { $0.offsetBy(dx: dx, dy: dy) }
  }
  static func valid(_ frames: [String: CGRect], geometry: PetGeometry, occupied: [String: CGRect])
    -> Bool
  {
    let values = Array(frames.values)
    return values.enumerated().allSatisfy { i, frame in
      geometry.fitCard(frame).equalTo(frame)
        && !occupied.values.contains { ActiveReminderDocking.overlaps(frame, $0) }
        && !values.dropFirst(i + 1).contains { ActiveReminderDocking.overlaps(frame, $0) }
    }
  }
  static func candidate(_ frames: [String: CGRect], slots: [ActiveReminderSlot])
    -> ActiveReminderSlot?
  {
    let box = bounds(frames)
    return slots.filter { slot in
      hypot(slot.frame.minX - box.minX, slot.frame.minY - box.minY) < 40
        || frames.values.contains { $0.intersects(slot.frame.insetBy(dx: -0.5, dy: -0.5)) }
    }.min {
      hypot($0.frame.minX - box.minX, $0.frame.minY - box.minY)
        < hypot($1.frame.minX - box.minX, $1.frame.minY - box.minY)
    }
  }
  static func guideSlots(
    _ slots: [ActiveReminderSlot], frame: CGRect, selected: ActiveReminderSlot?
  ) -> [ActiveReminderSlot] {
    var result = selected.map { [$0] } ?? []
    let nearby = slots.sorted {
      hypot($0.frame.minX - frame.minX, $0.frame.minY - frame.minY)
        < hypot($1.frame.minX - frame.minX, $1.frame.minY - frame.minY)
    }
    for slot in nearby where result.count < 3 {
      guard
        hypot(slot.frame.minX - frame.minX, slot.frame.minY - frame.minY)
          <= max(180, frame.width * 0.75),
        !result.contains(where: { $0.frame.insetBy(dx: -6, dy: -6).intersects(slot.frame) })
      else { continue }
      result.append(slot)
    }
    return result
  }
  static func stack(_ ids: [String], near frame: CGRect, geometry: PetGeometry) -> [String: CGRect]?
  {
    guard !ids.isEmpty else { return [:] }
    let area = geometry.conservativeCardBounds ?? geometry.bounds
    let rows = max(1, Int((area.height - 24) / minimum.height))
    let cols = Int(ceil(Double(ids.count) / Double(rows)))
    let size = CGSize(
      width: CGFloat(cols) * minimum.width, height: CGFloat(min(ids.count, rows)) * minimum.height)
    guard size.width <= area.width - 24, size.height <= area.height - 24 else { return nil }
    let box = geometry.fitCard(
      CGRect(x: frame.minX, y: frame.maxY - size.height, width: size.width, height: size.height))
    let result = Dictionary(
      uniqueKeysWithValues: ids.enumerated().map { i, id in
        (
          id,
          CGRect(
            x: box.minX + CGFloat(i / rows) * minimum.width,
            y: box.maxY - CGFloat(i % rows + 1) * minimum.height,
            width: minimum.width, height: minimum.height)
        )
      })
    return valid(result, geometry: geometry, occupied: [:]) ? result : nil
  }
  /// Reflow the original contact graph, retaining partial joins and the docked outer edge.
  static func reset(
    _ frames: [String: CGRect], targets: Set<String>, geometry: PetGeometry,
    occupied: [String: CGRect]
  ) -> [String: CGRect]? {
    guard let first = frames.keys.sorted().first else { return nil }
    let contacts = edges(frames)
    let old = bounds(frames)
    var next = frames.mapValues { $0 }
    for id in targets { next[id]?.size = minimum }
    var placed: Set<String> = [first]
    while placed.count < frames.count {
      var progress = false
      for edge in contacts {
        let a = placed.contains(edge.a) ? edge.a : edge.b
        let b = a == edge.a ? edge.b : edge.a
        guard placed.contains(a), !placed.contains(b), let oa = frames[a], let ob = frames[b],
          let na = next[a], var nb = next[b]
        else { continue }
        if abs(oa.maxX - ob.minX) < 1 || abs(ob.maxX - oa.minX) < 1 {
          nb.origin.x = ob.minX > oa.minX ? na.maxX : na.minX - nb.width
          nb.origin.y =
            na.minY
            + (abs(ob.maxY - oa.maxY) < 1
              ? na.height - nb.height
              : min(max(ob.minY - oa.minY, -nb.height + 16), na.height - 16))
        } else {
          nb.origin.y = ob.minY > oa.minY ? na.maxY : na.minY - nb.height
          nb.origin.x =
            na.minX
            + (abs(ob.maxX - oa.maxX) < 1
              ? na.width - nb.width : min(max(ob.minX - oa.minX, -nb.width + 16), na.width - 16))
        }
        next[b] = nb
        placed.insert(b)
        progress = true
      }
      if !progress { return nil }
    }
    let box = bounds(next)
    let edgeArea = (geometry.conservativeCardBounds ?? geometry.bounds).insetBy(dx: 12, dy: 12)
    let x = abs(old.maxX - edgeArea.maxX) < 2 ? old.maxX - box.width : old.minX
    let y = abs(old.maxY - edgeArea.maxY) < 2 ? old.maxY - box.height : old.minY
    let fitted = geometry.fitCard(CGRect(origin: CGPoint(x: x, y: y), size: box.size))
    next = translated(next, dx: fitted.minX - box.minX, dy: fitted.minY - box.minY)
    guard contacts.isSubset(of: edges(next)), valid(next, geometry: geometry, occupied: occupied)
    else { return nil }
    return next
  }
}
