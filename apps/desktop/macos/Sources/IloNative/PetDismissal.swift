import AppKit

/// A transient menu owns its dismissing click, including the matching release.
/// Nonactivating panels keep focus in quick access and require no event-tap permission.
final class PetDismissalSurface {
  var dismiss: (() -> Void)?
  private var panels: [PetPanel] = []

  func owns(_ window: NSWindow?) -> Bool {
    panels.contains { $0 === window }
  }

  func hide() {
    for panel in panels { panel.orderOut(nil) }
  }

  func update(visible: Bool, below owner: NSWindow) {
    guard visible else { hide(); return }
    let screens = NSScreen.screens
    if panels.count != screens.count {
      hide()
      panels = screens.map { _ in
        let panel = PetPanel(contentRect: .zero,
          styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.title = "nohmi quick access dismissal"
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.acceptsMouseMovedEvents = true
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenNone]
        let view = PetDismissalView(frame: .zero)
        view.dismiss = { [weak self] in self?.dismiss?() }
        panel.contentView = view
        return panel
      }
    }
    for (panel, screen) in zip(panels, screens) {
      panel.level = owner.level
      if panel.frame != screen.frame { panel.setFrame(screen.frame, display: false) }
      if !panel.isVisible { panel.order(.below, relativeTo: owner.windowNumber) }
    }
  }

  deinit { hide() }
}

private final class PetDismissalView: NSView {
  var dismiss: (() -> Void)?
  private var pressed = false
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  override func mouseDown(with event: NSEvent) { pressed = true }
  override func rightMouseDown(with event: NSEvent) { pressed = true }
  override func otherMouseDown(with event: NSEvent) { pressed = true }
  override func mouseUp(with event: NSEvent) { finish() }
  override func rightMouseUp(with event: NSEvent) { finish() }
  override func otherMouseUp(with event: NSEvent) { finish() }
  private func finish() {
    guard pressed else { return }
    pressed = false
    dismiss?()
  }
}
