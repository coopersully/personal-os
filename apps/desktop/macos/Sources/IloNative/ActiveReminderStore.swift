import AppKit
import Foundation

struct ActiveReminderPoint: Codable {
  var x: Double
  var y: Double
}
struct ActiveReminderCardGeometry: Codable {
  var x: Double
  var y: Double
  var width: Double
  var height: Double
}
struct ActiveReminderPlacement {
  static func anchors(in area: CGRect, size: CGSize) -> [CGRect] {
    anchors(in: PetGeometry(bounds: area, obstacles: []), size: size)
  }
  static func anchors(in geometry: PetGeometry, size: CGSize) -> [CGRect] {
    let bounds = (geometry.conservativeCardBounds ?? geometry.bounds).insetBy(dx: 12, dy: 12)
    let width = min(size.width, bounds.width)
    let height = min(size.height, bounds.height)
    let points: [(CGFloat, CGFloat)] = [
      (0, 1), (0.5, 1), (1, 1), (1, 0.5), (1, 0), (0.5, 0), (0, 0), (0, 0.5),
      (0.25, 1), (0.75, 1), (1, 0.75), (1, 0.25),
      (0.75, 0), (0.25, 0), (0, 0.25), (0, 0.75),
    ]
    return points.map { x, y in
      geometry.fitCard(
        CGRect(
          x: bounds.minX + (bounds.width - width) * x,
          y: bounds.minY + (bounds.height - height) * y, width: width, height: height))
    }
  }
  static func anchor(for frame: CGRect, in area: CGRect) -> Int? {
    anchor(for: frame, in: PetGeometry(bounds: area, obstacles: []))
  }
  static func anchor(for frame: CGRect, in geometry: PetGeometry) -> Int? {
    let choices = anchors(in: geometry, size: frame.size).enumerated().map {
      ($0.offset, hypot($0.element.midX - frame.midX, $0.element.midY - frame.midY))
    }
    guard let closest = choices.min(by: { $0.1 < $1.1 }), closest.1 <= 80 else { return nil }
    return closest.0
  }
  static func fit(_ frame: CGRect, geometry: PetGeometry) -> CGRect { geometry.fitCard(frame) }
  static func unoccupied(in geometry: PetGeometry, occupied: [CGRect]) -> CGRect {
    let area = geometry.bounds
    for size in [CGSize(width: 320, height: 88), CGSize(width: 240, height: 72)] {
      let centered = fit(
        CGRect(
          x: area.midX - size.width / 2, y: area.midY - size.height / 2,
          width: size.width, height: size.height), geometry: geometry)
      if !occupied.contains(where: { $0.intersects(centered.insetBy(dx: -6, dy: -6)) }) {
        return centered
      }
      var y = area.maxY - size.height - 12
      while y >= area.minY {
        var x = area.minX + 12
        while x + size.width <= area.maxX {
          let frame = fit(CGRect(origin: CGPoint(x: x, y: y), size: size), geometry: geometry)
          if !occupied.contains(where: { $0.intersects(frame.insetBy(dx: -6, dy: -6)) }) {
            return frame
          }
          x += size.width + 12
        }
        y -= size.height + 12
      }
    }
    // A finite screen can fill up; keep every window present and its drag handle reachable.
    let offset = Double(occupied.count % 12) * 24
    return fit(
      CGRect(x: area.minX + offset, y: area.maxY - 88 - offset, width: 240, height: 88),
      geometry: geometry)
  }

}
final class ActiveReminderStore {
  private struct DataModel: Codable {
    var identity: String
    var receipts: [String: Double] = [:]
    var placements: [String: ActiveReminderPoint] = [:]
    var cards: [String: [String: ActiveReminderCardGeometry]]? = nil
    var cardDisplays: [String: String]? = nil
  }
  private let url: URL
  private var data: DataModel
  init(url: URL, identity: String) throws {
    self.url = url
    if FileManager.default.fileExists(atPath: url.path) {
      let stored = try JSONDecoder().decode(DataModel.self, from: Data(contentsOf: url))
      data = stored.identity == identity ? stored : DataModel(identity: identity)
    } else {
      data = DataModel(identity: identity)
    }
  }
  func erase() throws {
    if FileManager.default.fileExists(atPath: url.path) {
      try FileManager.default.removeItem(at: url)
    }
    data = DataModel(identity: data.identity)
  }
  func contains(_ id: String) -> Bool { data.receipts[id] != nil }
  func markShown(_ id: String, at now: Date) throws {
    var next = data
    next.receipts[id] = now.timeIntervalSince1970
    if next.receipts.count > 4096 {
      next.receipts = Dictionary(
        uniqueKeysWithValues: next.receipts.sorted { $0.value > $1.value }.prefix(4096).map {
          ($0.key, $0.value)
        })
    }
    try save(next)
  }
  func placement(display: String) -> ActiveReminderPoint? { data.placements[display] }
  func savePlacement(display: String, point: ActiveReminderPoint) throws {
    guard point.x.isFinite, point.y.isFinite else { return }
    var next = data
    next.placements[display] = ActiveReminderPoint(
      x: min(1, max(0, point.x)), y: min(1, max(0, point.y)))
    try save(next)
  }
  func cardDisplay(card: String) -> String? { data.cardDisplays?[card] }
  func cardPlacement(card: String, display: String) -> ActiveReminderCardGeometry? {
    data.cards?[card]?[display]
  }
  func saveCardPlacement(card: String, display: String, geometry: ActiveReminderCardGeometry) throws
  {
    guard [geometry.x, geometry.y, geometry.width, geometry.height].allSatisfy(\.isFinite),
      geometry.width > 0, geometry.height > 0
    else { return }
    var next = data
    var cards = next.cards ?? [:]
    var displays = cards[card] ?? [:]
    displays[display] = ActiveReminderCardGeometry(
      x: min(1, max(0, geometry.x)),
      y: min(1, max(0, geometry.y)), width: geometry.width, height: geometry.height)
    cards[card] = displays
    next.cards = cards
    var displayIDs = next.cardDisplays ?? [:]
    displayIDs[card] = display
    next.cardDisplays = displayIDs
    try save(next)
  }
  private func save(_ next: DataModel) throws {
    try FileManager.default.createDirectory(
      at: url.deletingLastPathComponent(), withIntermediateDirectories: true,
      attributes: [.posixPermissions: 0o700])
    try JSONEncoder().encode(next).write(to: url, options: .atomic)
    data = next
  }
}
