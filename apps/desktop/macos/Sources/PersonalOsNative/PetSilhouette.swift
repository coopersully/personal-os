import AppKit

/// Logical artwork geometry shared by drawing and input; shadows are never interactive.
enum PetSilhouette {
  static func path(bob: CGFloat = 0, hover: CGFloat = 0, earLift: CGFloat = 0) -> CGPath {
    let path = CGMutablePath()
    path.addRoundedRect(in: CGRect(x: 13, y: 12 + bob, width: 46, height: 40 + hover * 2),
      cornerWidth: 19, cornerHeight: 19)
    path.addEllipse(in: CGRect(x: 13, y: 39 + bob, width: 14, height: 19 + earLift))
    path.addEllipse(in: CGRect(x: 44, y: 39 + bob, width: 14, height: 19 + earLift))
    return path
  }
  static func contains(_ point: CGPoint, transform: CGAffineTransform, clip: CGRect) -> Bool {
    guard clip.contains(point), abs(transform.a * transform.d - transform.b * transform.c) > 0.00001 else { return false }
    return path().contains(point.applying(transform.inverted()))
  }
}
