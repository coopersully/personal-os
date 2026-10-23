import AppKit
import SwiftUI

/// Uses the TaskItem/ReminderItem row rules from commitment-item.tsx, workspace-row.tsx
/// and reminders/page.tsx, including their semantic colors (styles.css).
private enum CommitmentColors {
  static func color(_ light: UInt32, _ dark: UInt32) -> Color {
    Color(
      nsColor: NSColor(name: nil) { appearance in
        let value = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light
        return NSColor(
          srgbRed: Double((value >> 16) & 255) / 255,
          green: Double((value >> 8) & 255) / 255,
          blue: Double(value & 255) / 255, alpha: 1)
      })
  }
  static let paper = color(0xf9f9f9, 0x2d2d2d)
  static let ink = color(0x202020, 0xeeeeee)
  static let muted = color(0x5b5b5b, 0xb8b8b8)
  static let input = color(0xd9d9d9, 0x606060)
  static let danger = color(0xb44333, 0xe08d7b)
}
final class ActiveReminderAppearance: ObservableObject {
  @Published var seams = ActiveReminderSeams()
}
private struct ActiveReminderDueLabel: View {
  let due: Date
  @ObservedObject var clock: ActiveReminderClock
  var status: String?
  var detail: String?
  var body: some View {
    HStack(spacing: 6) {
      Text(clock.absoluteLabel(for: due)).foregroundStyle(CommitmentColors.muted)
      Spacer(minLength: 0)
      Text(status ?? ActiveReminderDueText.compact(due, now: clock.now))
        .foregroundStyle(
          due < clock.now || status == "Retry completion"
            ? CommitmentColors.danger : CommitmentColors.muted)
    }
    .font(.system(size: 11, design: .monospaced)).lineLimit(1)
    .help(
      [detail, due.formatted(date: .complete, time: .complete)].compactMap { $0 }.joined(
        separator: "\n")
    )
    .accessibilityLabel(
      "Due " + due.formatted(date: .complete, time: .complete) + ", "
        + (detail ?? status ?? ActiveReminderDueText.relative(due, now: clock.now)))
  }
}
struct ActiveReminderCard: View {
  @ObservedObject var appearance: ActiveReminderAppearance
  let clock: ActiveReminderClock
  var item: ActiveReminderCandidate
  var preview: Bool
  var pending: Bool
  var error: String?
  var stale: Bool
  var complete: () -> Void
  var open: () -> Void
  private var isTask: Bool { item.kind == "task" }
  var body: some View {
    GeometryReader { bounds in
      ScrollView {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
          Button(action: complete) {
            ZStack {
              RoundedRectangle(cornerRadius: 3)
                .fill(CommitmentColors.input.opacity(0.7)).frame(width: 16, height: 16)
              if pending { ProgressView().controlSize(.mini).scaleEffect(0.65) }
            }.frame(width: 16, height: 20, alignment: .top)
              .contentShape(Rectangle())
          }
          .alignmentGuide(.firstTextBaseline) { $0[.top] + 13 }
          .buttonStyle(.plain).disabled(pending || stale)
          .accessibilityLabel(
            pending
              ? "Completing"
              : (error == nil
                ? "Complete \(item.kind)" : "Retry completing \(item.kind)")
          )
          .help(error == nil ? "Mark complete" : "Try again")
          .keyboardShortcut(.return, modifiers: .command)
          VStack(alignment: .leading, spacing: 4) {
            Button(action: open) {
              Text(preview ? item.title : "A \(item.kind) is due")
                .font(.system(size: 14, weight: .medium)).lineSpacing(2)
                .multilineTextAlignment(.leading).lineLimit(bounds.size.height < 84 ? 1 : 2)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
            }.buttonStyle(.plain).help("Open \(item.kind) in nohmi")
            if let due = parseDate(item.dueAt) {
              ActiveReminderDueLabel(
                due: due, clock: clock,
                status: error != nil
                  ? "Retry completion" : stale ? "Sync needed" : pending ? "Saving…" : nil,
                detail: error)
            }
          }
        }.padding(.horizontal, 10).padding(.vertical, 10)
      }
    }
    .foregroundStyle(CommitmentColors.ink)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .background {
      let corners = appearance.seams.corners
      UnevenRoundedRectangle(
        topLeadingRadius: corners.contains(.topLeft) ? 0 : 6,
        bottomLeadingRadius: corners.contains(.bottomLeft) ? 0 : 6,
        bottomTrailingRadius: corners.contains(.bottomRight) ? 0 : 6,
        topTrailingRadius: corners.contains(.topRight) ? 0 : 6
      )
      .fill(CommitmentColors.paper)
      .animation(
        .easeOut(duration: NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? 0 : 0.12),
        value: corners.rawValue)
    }
    .overlay {
      Canvas { context, size in
        let corners = appearance.seams.corners
        let shape = UnevenRoundedRectangle(
          topLeadingRadius: corners.contains(.topLeft) ? 0 : 6,
          bottomLeadingRadius: corners.contains(.bottomLeft) ? 0 : 6,
          bottomTrailingRadius: corners.contains(.bottomRight) ? 0 : 6,
          topTrailingRadius: corners.contains(.topRight) ? 0 : 6)
        context.stroke(
          shape.path(in: CGRect(origin: .zero, size: size).insetBy(dx: 0.5, dy: 0.5)),
          with: .color(Color(nsColor: .separatorColor)), lineWidth: 1)
        for rect in appearance.seams.sharedEdges {
          context.fill(
            Path(rect.insetBy(dx: rect.width == 1 ? -1 : 0, dy: rect.height == 1 ? -1 : 0)),
            with: .color(CommitmentColors.paper))
        }
      }.allowsHitTesting(false)
    }
  }
}
