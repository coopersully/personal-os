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
  static func unoccupied(in area: CGRect, occupied: [CGRect]) -> CGRect {
    for size in [CGSize(width: 320, height: 88), CGSize(width: 240, height: 72)] {
      let centered = fit(
        CGRect(
          x: area.midX - size.width / 2, y: area.midY - size.height / 2,
          width: size.width, height: size.height), in: area, snap: false)
      if !occupied.contains(where: { $0.intersects(centered.insetBy(dx: -6, dy: -6)) }) {
        return centered
      }
      var y = area.maxY - size.height - 12
      while y >= area.minY {
        var x = area.minX + 12
        while x + size.width <= area.maxX {
          let frame = CGRect(origin: CGPoint(x: x, y: y), size: size)
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
      in: area, snap: false)
  }
  static func fit(_ frame: CGRect, in area: CGRect, snap: Bool) -> CGRect {
    var frame = frame
    frame.size.width = min(frame.width, area.width)
    frame.size.height = min(frame.height, area.height)
    frame.origin.x = min(max(frame.minX, area.minX), area.maxX - frame.width)
    frame.origin.y = min(max(frame.minY, area.minY), area.maxY - frame.height)
    if snap {
      if frame.minX - area.minX <= 24 {
        frame.origin.x = area.minX
      } else if area.maxX - frame.maxX <= 24 {
        frame.origin.x = area.maxX - frame.width
      }
      if frame.minY - area.minY <= 24 {
        frame.origin.y = area.minY
      } else if area.maxY - frame.maxY <= 24 {
        frame.origin.y = area.maxY - frame.height
      }
    }
    return frame
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
