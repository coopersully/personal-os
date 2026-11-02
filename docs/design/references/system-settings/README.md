# System Settings Reference Study

Observed through native computer use on October 21, 2026. This is supporting evidence,
not a competing product specification. The accepted rules live in
[Settings](../../pages/settings.md) and [Settings UI Standards](../../../engineering/settings-ui-standards.md).
No preferences, permissions, account connections, or security settings were changed.

## Coverage and evidence

Twenty-one screenshots were captured in a local gallery, outside the repository because
screenshots include personal account/device context. Capture numbers identify the views:

| Captures | Observed pattern | Application to nohmi |
| --- | --- | --- |
| 01 General | Sidebar category; centered introduction; grouped destination rows | Separate category identity from subsection labels and individual controls |
| 02 Date & Time | Direct switches; trailing effective values; automatic mode alongside source | Distinguish configured preference, effective value, and authority |
| 03–04 Appearance/menu | Visual choices, small option menu, radios, sliders | Pick a control by decision type; do not flatten previews into text |
| 05 Sound | Direct controls alongside an input/output device collection | Records and preferences need different compositions |
| 06–07 Notifications | Global defaults, per-app summaries, detail controls | Keep scope explicit; summary rows lead to one canonical editor |
| 08–09 Keyboard/shortcuts | Compact settings; advanced sheet with its own navigation and Done | Bounded complex tasks can retain local structure without crowding the parent |
| 10–11 Internet Accounts/add | Account summaries; a focused first setup step, disabled Continue until input | Keep connection identity visible; separate setup from routine settings |
| 12–13 Privacy/Calendars | Permission categories summarize access; detail rows show effective scope | A binary switch alone is insufficient for multi-level permission |
| 14 Trackpad | Tabs, sliders, gesture-specific choices | Use specialized controls for spatial or demonstrated behavior |
| 15–16 Displays/Night Shift | Selected-device context, visual options, scheduling sheet | The selected object controls which values are being edited |
| 17–18 Accessibility/Motion | Purpose-based category groups; short direct controls and targeted explanation | Group by the person's task; explain only non-obvious effects |
| 19–20 Battery/health | Read-only state/history, preference, informational sheet | Status is not an editable preference; information is not a command |
| 21 Search attempt | Query entered, but result navigation was not confirmed | No claim of successful search routing from this observation |

Sheets and menus were closed without choosing new values. The initial Apple Account
screen was inspected but not saved as a separate capture. Authentication, destructive
flows, offline behavior, write persistence, mobile adaptation, and error recovery were
not exercised. These observations do not establish those implementation details.

## Public framework evidence

Apple explicitly describes the Ventura System Settings navigation as split views and
stacks. The same presentation introduces grouped forms and LabeledContent, including
leading labels, trailing values, and lightweight controls with stronger hover treatment.
This is a documented architectural precedent, not proof that every pane in the currently
installed application uses the same internal implementation.

- [What's new in SwiftUI, WWDC22 — navigation and controls](https://developer.apple.com/videos/play/wwdc2022/10052/)
- [Settings Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/settings)
- [NavigationSplitView](https://developer.apple.com/documentation/swiftui/navigationsplitview)
- [Form](https://developer.apple.com/documentation/swiftui/form)
- [GroupedFormStyle](https://developer.apple.com/documentation/swiftui/groupedformstyle)

## Interpretation and deliberate differences

The transferable model is a stable navigation shell around grouped, typed settings,
with local detail navigation and bounded editors. A setting has scope, an effective
value, editing semantics, and a state/authority boundary. This is our interpretation
of the visible behavior; the application’s private service and persistence architecture
was not inspected.

Keep nohmi's established arrow for navigation and chevron for modal editors, rather
than copying Apple's destination chevrons. Keep shadcn controls, reicon glyphs, brand
marks, Sonner feedback, neutral theme tokens, and browser/desktop parity. Do not copy
Apple artwork, glass effects, platform-only behavior, or its occasional verbose help
blocks. Useful field explanations are allowed; generic description-only subsection
headers are not. Main page introductions remain, with the explicit Profile exception.
