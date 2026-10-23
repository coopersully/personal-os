// Standalone developer sample app. Never links the authenticated desktop runtime.
import AppKit
import Foundation

final class Preview: NSObject, NSApplicationDelegate {
  let presenter = ActiveReminderPanelController()
  var items: [ActiveReminderCandidate] = []
  var pending = Set<String>()
  var errors: [String: String] = [:]
  let root = URL(fileURLWithPath: "/tmp/nohmi-active-card-preview")
  func render() {
    try? presenter.show(items, preview: true, pending: pending, errors: errors, stale: false)
  }
  func record(_ action: String, _ item: String = "") {
    let url = root.appendingPathComponent("actions.jsonl")
    let line =
      (try? JSONSerialization.data(withJSONObject: ["action": action, "item": item])) ?? Data()
    if !FileManager.default.fileExists(atPath: url.path) {
      FileManager.default.createFile(atPath: url.path, contents: nil)
    }
    if let file = try? FileHandle(forWritingTo: url) {
      file.seekToEndOfFile()
      file.write(line + Data([10]))
      try? file.close()
    }
  }
  func applicationDidFinishLaunching(_ note: Notification) {
    let instant = Date()
    let formatter = ISO8601DateFormatter()
    let offsets: [Double] = [-903, 903, 43200, 97200]
    for (i, title) in [
      "Send the draft", "Take a stretch break", "Review tomorrow’s plan", "Refill the water bottle",
    ].enumerated() {
      items.append(
        ActiveReminderCandidate(
          id: String(format: "00000000-0000-4000-8000-%012d", i + 1),
          kind: i % 2 == 0 ? "task" : "reminder", title: title,
          dueAt: formatter.string(from: instant.addingTimeInterval(offsets[i])),
          activeReminder: true, revision: i % 2 == 0 ? 1 : nil,
          updatedAt: i % 2 == 0 ? nil : formatter.string(from: instant)))
    }
    ActiveReminderAudio.preload()
    presenter.complete = { [weak self] item in
      guard let self else { return }
      self.pending.insert(item.cardID)
      self.render()
      self.record("sample-completion-pending", item.cardID)
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
        self.pending.remove(item.cardID)
        let fail = self.root.appendingPathComponent("fail-next")
        if FileManager.default.fileExists(atPath: fail.path) {
          try? FileManager.default.removeItem(at: fail)
          self.errors[item.cardID] = "Sample acknowledgement failed. Try again."
          self.record("sample-completion-failed", item.cardID)
        } else {
          self.presenter.completed(item)
          self.items.removeAll { $0.cardID == item.cardID }
          self.record("sample-completion-acknowledged", item.cardID)
        }
        self.render()
      }
    }
    presenter.open = { [weak self] item in self?.record("sample-open", item.cardID) }
    presenter.settings = { [weak self] in self?.record("sample-settings") }
    presenter.snooze = { [weak self] item in
      guard let self else { return }
      self.record("sample-snooze", item.cardID)
      self.items.removeAll { $0.cardID == item.cardID }
      self.render()
      DispatchQueue.main.asyncAfter(deadline: .now() + 900) {
        self.items.append(item)
        self.render()
      }
    }
    render()
    if let screen = NSScreen.main {
      let area = PetDisplays.geometry(screen).bounds
      let origins = [
        CGPoint(x: area.midX - 240, y: area.midY), CGPoint(x: area.midX, y: area.midY),
        CGPoint(x: area.minX + 24, y: area.maxY - 100),
        CGPoint(x: area.maxX - 264, y: area.maxY - 100),
      ]
      for (i, item) in items.enumerated() {
        presenter.panels[item.cardID]?.setFrameOrigin(origins[i])
      }
    }
    Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in
      guard let self else { return }
      let frames = self.presenter.panels.mapValues {
        [
          "x": $0.frame.minX, "y": $0.frame.minY, "width": $0.frame.width,
          "height": $0.frame.height,
        ]
      }
      let edges = self.presenter.locks.map { ["a": $0.a, "b": $0.b] }
      if let data = try? JSONSerialization.data(withJSONObject: ["frames": frames, "locks": edges])
      {
        try? data.write(to: self.root.appendingPathComponent("state.json"), options: .atomic)
      }
    }
    Timer.scheduledTimer(withTimeInterval: 900, repeats: false) { _ in NSApp.terminate(nil) }
  }
  func applicationWillTerminate(_ note: Notification) { presenter.reset() }
}
let app = NSApplication.shared
let delegate = Preview()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
