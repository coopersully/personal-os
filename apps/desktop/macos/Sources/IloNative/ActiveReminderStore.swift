import AppKit
import Foundation

struct ActiveReminderPoint: Codable {
  var x: Double
  var y: Double
}
struct ActiveReminderPlacement {
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
  private func save(_ next: DataModel) throws {
    try FileManager.default.createDirectory(
      at: url.deletingLastPathComponent(), withIntermediateDirectories: true,
      attributes: [.posixPermissions: 0o700])
    try JSONEncoder().encode(next).write(to: url, options: .atomic)
    data = next
  }
}
