import Foundation

struct ActiveReminderCandidate: Codable, Equatable, Identifiable {
  var id: String
  var kind: String
  var title: String
  var dueAt: String
  var activeReminder: Bool
  var revision: Int?
  var updatedAt: String?
  var valid: Bool { activeReminder && validSource }
  var validSource: Bool {
    UUID(uuidString: id) != nil && parseDate(dueAt) != nil
      && ((kind == "task" && (revision ?? 0) > 0)
        || (kind == "reminder" && parseDate(updatedAt) != nil))
  }
  var sourceRevision: String { kind == "task" ? String(revision ?? 0) : (updatedAt ?? "") }
  func occurrenceID(identity: String) -> String { stableID(identity, kind, id, dueAt) }
}
struct ActiveReminderInventory: Codable {
  var serverUrl: String
  var accountId: String
  var generation: UInt64
  var generatedAt: String
  var items: [ActiveReminderCandidate]
  var ordinaryItems: [ActiveReminderCandidate]? = nil
  var identity: String { "\(serverUrl)|\(accountId)" }
  func isFresh(at now: Date) -> Bool {
    guard let generated = parseDate(generatedAt) else { return false }
    return (0...15).contains(now.timeIntervalSince(generated))
  }
}
