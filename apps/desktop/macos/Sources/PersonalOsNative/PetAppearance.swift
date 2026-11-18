import Foundation

struct PetAppearanceState {
  private(set) var session: String?
  private(set) var revision = 0
  private(set) var active = false
  mutating func begin(_ session: String) { self.session = session; revision = 0; active = false }
  mutating func accept(session: String, revision: Int) -> Bool {
    guard self.session == session, revision > self.revision else { return false }
    self.revision = revision; active = true
    return true
  }
  mutating func finish(session: String, revision: Int) {
    if self.session == session && self.revision <= revision { self.revision = revision; active = false }
  }
  mutating func clear() { session = nil; revision = 0; active = false }
}
