import Foundation

/// One reversible, display-clock-driven spring owns the entire pet/card handoff.
/// Preserve velocity on reversal; never schedule a stale delayed hide callback.
struct PetTransition {
  private(set) var progress: Double = 0
  private(set) var velocity: Double = 0
  private(set) var target: Double = 0
  var isSettled: Bool { progress == target && velocity == 0 }
  var state: String {
    isSettled ? (target == 1 ? "open" : "idle") : (target == 1 ? "opening" : "closing")
  }
  mutating func request(open: Bool, immediately: Bool = false) {
    target = open ? 1 : 0
    if immediately {
      progress = target
      velocity = 0
    }
  }
  mutating func advance(seconds: Double, reducedMotion: Bool) {
    guard seconds.isFinite, seconds > 0, !isSettled else { return }
    let dt = min(seconds, 0.1)
    if reducedMotion {
      let step = dt / 0.12
      progress = target > progress ? min(target, progress + step) : max(target, progress - step)
      velocity = 0
    } else {
      let omega = 24.0
      let offset = progress - target
      let coefficient = velocity + omega * offset
      let decay = exp(-omega * dt)
      progress = target + (offset + coefficient * dt) * decay
      velocity = (velocity - omega * coefficient * dt) * decay
      if progress < 0 || progress > 1 {
        progress = min(1, max(0, progress))
        velocity = 0
      }
      if abs(progress - target) < 0.001 && abs(velocity) < 0.02 {
        progress = target
        velocity = 0
      }
    }
  }
  static func ramp(_ value: Double, from: Double, to: Double) -> Double {
    let t = min(1, max(0, (value - from) / (to - from)))
    return t * t * (3 - 2 * t)
  }
}

/// Changing the compact destination mid-transition must preserve the current scene.
/// This transient offset vanishes at either endpoint, including after a reversal.
struct PetPoseCorrection {
  private var delta = CGPoint.zero
  private var pivot = 0.0
  mutating func reset() {
    delta = .zero
    pivot = 0
  }
  func offset(at progress: Double) -> CGPoint {
    guard pivot > 0, pivot < 1 else { return .zero }
    let weight = progress <= pivot ? progress / pivot : (1 - progress) / (1 - pivot)
    return CGPoint(x: delta.x * weight, y: delta.y * weight)
  }
  mutating func rebase(from old: CGPoint, to new: CGPoint, at progress: Double) {
    let current = offset(at: progress)
    delta = CGPoint(
      x: current.x + (old.x - new.x) * (1 - progress),
      y: current.y + (old.y - new.y) * (1 - progress))
    pivot = progress
  }
}
