import AppKit

enum PetAttachment: String {
  case top, bottom, left, right, hidden
  var angle: CGFloat {
    switch self {
    case .bottom: return 180
    case .left: return 90
    case .right: return -90
    default: return 0
    }
  }
}
struct PetGeometry: Equatable {
  var bounds: CGRect
  var obstacles: [CGRect]
  var conservativeCardBounds: CGRect?
  var inset: CGRect { bounds.insetBy(dx: 12, dy: 12) }
  func compactHitFrame(
    compact: CGRect, visible: CGRect, tucked: CGRect, keepWakeArea: Bool
  ) -> CGRect {
    let frame = keepWakeArea && tucked != .zero ? compact.union(tucked) : visible
    return frame.intersection(bounds)
  }
  func fit(_ rect: CGRect) -> CGRect {
    let size = CGSize(width: min(rect.width, inset.width), height: min(rect.height, inset.height))
    let clamped = CGRect(
      origin: CGPoint(
        x: min(max(rect.minX, inset.minX), inset.maxX - size.width),
        y: min(max(rect.minY, inset.minY), inset.maxY - size.height)), size: size)
    let blocked = obstacles.map { $0.insetBy(dx: -8, dy: -8) }
    var xs = [clamped.minX]
    var ys = [clamped.minY]
    for obstacle in blocked {
      xs += [obstacle.minX - size.width, obstacle.maxX]
      ys += [obstacle.minY - size.height, obstacle.maxY]
    }
    let candidates = xs.flatMap { x in
      ys.map { y in CGRect(origin: CGPoint(x: x, y: y), size: size) }
    }
    if let fitted = candidates.filter({ candidate in
      inset.contains(candidate) && !blocked.contains(where: { $0.intersects(candidate) })
    })
    .min(by: {
      hypot($0.minX - rect.minX, $0.minY - rect.minY)
        < hypot($1.minX - rect.minX, $1.minY - rect.minY)
    }) {
      return fitted
    }
    // Resize only when translation cannot avoid an obstacle. Prefer the largest free
    // region, then the closest placement; a large card must never cover the Dock.
    var regions = [inset]
    for obstacle in blocked {
      regions = regions.flatMap { region -> [CGRect] in
        guard region.intersects(obstacle) else { return [region] }
        return [
          CGRect(
            x: region.minX, y: region.minY, width: max(0, obstacle.minX - region.minX),
            height: region.height),
          CGRect(
            x: max(region.minX, obstacle.maxX), y: region.minY,
            width: max(0, region.maxX - obstacle.maxX), height: region.height),
          CGRect(
            x: region.minX, y: region.minY, width: region.width,
            height: max(0, obstacle.minY - region.minY)),
          CGRect(
            x: region.minX, y: max(region.minY, obstacle.maxY), width: region.width,
            height: max(0, region.maxY - obstacle.maxY)),
        ].map { $0.intersection(region) }.filter { !$0.isEmpty && !$0.isNull }
      }
    }
    return regions.map { region in
      let width = min(size.width, region.width)
      let height = min(size.height, region.height)
      return CGRect(
        x: min(max(rect.minX, region.minX), region.maxX - width),
        y: min(max(rect.minY, region.minY), region.maxY - height), width: width, height: height)
    }.sorted { a, b in
      if a.width * a.height != b.width * b.height { return a.width * a.height > b.width * b.height }
      return hypot(a.minX - rect.minX, a.minY - rect.minY)
        < hypot(b.minX - rect.minX, b.minY - rect.minY)
    }.first ?? clamped
  }
  func closedPet(frame: CGRect, size: CGSize, anchor: Int?) -> CGRect {
    if let anchor, (0..<8).contains(anchor) { return anchors(size: size)[anchor] }
    return fit(CGRect(origin: frame.origin, size: size))
  }
  func fitCard(_ rect: CGRect) -> CGRect {
    PetGeometry(bounds: conservativeCardBounds ?? bounds, obstacles: obstacles).fit(rect)
  }
  func card(size: CGSize, anchor: Int?, near: CGPoint) -> CGRect {
    if let conservativeCardBounds {
      return PetGeometry(bounds: conservativeCardBounds, obstacles: obstacles)
        .card(size: size, anchor: anchor, near: near)
    }
    let size = CGSize(width: min(size.width, inset.width), height: min(size.height, inset.height))
    guard let anchor, (0..<8).contains(anchor) else {
      return fit(
        CGRect(
          x: near.x - size.width / 2, y: near.y - size.height / 2, width: size.width,
          height: size.height))
    }
    let columns = [0, 1, 2, 2, 2, 1, 0, 0]
    let rows = [2, 2, 2, 1, 0, 0, 0, 1]
    let x = [inset.minX, inset.midX - size.width / 2, inset.maxX - size.width][columns[anchor]]
    let y = [inset.minY, inset.midY - size.height / 2, inset.maxY - size.height][rows[anchor]]
    return fit(CGRect(origin: CGPoint(x: x, y: y), size: size))
  }
  func anchors(size: CGSize) -> [CGRect] {
    let compact = PetGeometry(bounds: bounds, obstacles: obstacles)
    return (0..<8).map { compact.card(size: size, anchor: $0, near: .zero) }
  }
  func snap(cursor: CGPoint, size: CGSize) -> Int? {
    let candidates = anchors(size: size).enumerated().map {
      ($0.offset, hypot($0.element.midX - cursor.x, $0.element.midY - cursor.y))
    }
    guard let nearest = candidates.min(by: { $0.1 < $1.1 }), nearest.1 <= max(68, size.width * 0.65)
    else { return nil }
    return nearest.0
  }
  func petFrame(card: CGRect, size: CGFloat, edge: PetAttachment) -> CGRect {
    let lip = size / 18
    let center: CGPoint
    switch edge {
    case .top: center = CGPoint(x: card.midX, y: card.maxY + lip)
    case .bottom: center = CGPoint(x: card.midX, y: card.minY - lip)
    case .left: center = CGPoint(x: card.minX - lip, y: card.midY)
    case .right: center = CGPoint(x: card.maxX + lip, y: card.midY)
    case .hidden: center = CGPoint(x: card.midX, y: card.midY)
    }
    return CGRect(x: center.x - size / 2, y: center.y - size / 2, width: size, height: size)
  }
  func attachment(card: CGRect, petSize: CGFloat, preferred: PetAttachment) -> PetAttachment {
    let choices: [PetAttachment] = [preferred, .top, .bottom, .left, .right].filter {
      $0 != .hidden
    }
    return choices.first { edge in
      let frame = petFrame(card: card, size: petSize, edge: edge)
      return bounds.contains(frame) && !obstacles.contains(where: { $0.intersects(frame) })
    } ?? .hidden
  }
  func tucked(frame: CGRect, anchor: Int) -> (CGRect, PetAttachment)? {
    guard (0..<8).contains(anchor) else { return nil }
    // Corners may use their other edge when the Dock blocks the preferred one.
    let edges: [[PetAttachment]] = [
      [.bottom, .right], [.bottom], [.bottom, .left], [.left],
      [.top, .left], [.top], [.top, .right], [.right],
    ]
    for edge in edges[anchor] {
      var result = frame
      switch edge {
      case .bottom:
        result.origin.y = bounds.maxY - frame.height / 2 - frame.height / 18
      case .left:
        result.origin.x = bounds.maxX - frame.width / 2 - frame.width / 18
      case .right:
        result.origin.x = bounds.minX - frame.width / 2 + frame.width / 18
      case .top:
        result.origin.y = bounds.minY - frame.height / 2 + frame.height / 18
      case .hidden: continue
      }
      // The whole hide/reveal corridor must be clear, not only the final exposed face.
      if !obstacles.contains(where: {
        $0.insetBy(dx: -8, dy: -8).intersects(frame.union(result))
      }) {
        return (result, edge)
      }
    }
    return nil
  }
}
struct PetIdlePolicy {
  private var since: Double?
  mutating func update(now: Double, eligible: Bool, delay: Double = 3) -> Bool {
    guard eligible, now.isFinite else {
      since = nil
      return false
    }
    if since == nil || now < since! { since = now }
    return now - since! >= delay
  }
}
