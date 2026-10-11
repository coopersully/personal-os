import Foundation

/// Observation only: this gesture never enlarges the native input region.
struct PetShoo {
  var sensitivity: String
  private var start: CGPoint?
  private var began = 0.0, lastTime = 0.0
  private var axis: Bool?
  private var extremum: CGFloat = 0
  private var direction: CGFloat = 0
  private var strokes = 0
  mutating func reset() { start = nil; axis = nil; direction = 0; strokes = 0 }
  mutating func update(point: CGPoint, time: Double, eligible: Bool, overArtwork: Bool, region: CGRect) -> Bool {
    let length: CGFloat = sensitivity == "low" ? 24 : sensitivity == "high" ? 12 : 18
    let count = sensitivity == "low" ? 6 : 4
    let duration = sensitivity == "low" ? 0.8 : sensitivity == "high" ? 0.9 : 0.7
    guard eligible, region.contains(point), time.isFinite else { reset(); return false }
    if start != nil && (time - lastTime > 0.15 || time < lastTime || time - began > duration) { reset() }
    lastTime = time
    guard let start else {
      if overArtwork { self.start = point; began = time }
      return false
    }
    if axis == nil {
      let dx = point.x - start.x, dy = point.y - start.y
      guard max(abs(dx), abs(dy)) >= length else { return false }
      axis = abs(dx) >= abs(dy)
      direction = (axis! ? dx : dy) > 0 ? 1 : -1
      extremum = axis! ? point.x : point.y
      strokes = 1
      return false
    }
    let value = axis! ? point.x : point.y
    if (value - extremum) * direction > 0 { extremum = value }
    else if (extremum - value) * direction >= length {
      direction = -direction
      extremum = value
      strokes += 1
      if strokes >= count { reset(); return true }
    }
    return false
  }
}
