# Finance for iPhone — proposed page UX

November 7, 2026 · COO-210 — Mobile Finance

Status: approved by Cooper on November 7, 2026. This document preserves the target map and original synthetic-data prototype specification. Native implementation is tracked by COO-210 — Mobile Finance; the full parity map below is not a claim that every workflow has shipped. The original web audit used checkout 156518c3.

## Direction

Use five stable native tabs: Overview, Spending, Plan, Accounts, Assistant. Replace the current mobile shell’s intermediate Money / Planning / Manage directories. These are proposed mobile presentation changes; the domain model and API remain shared with web.

Overview answers “Where do I stand and what is coming?” Spending answers “Where did the money go?” Plan answers “What have I committed to?” Accounts answers “What information is this based on?” Assistant answers “What needs my judgment, and what did nohmi do?”

Alternatives considered: retain the web grouping (faithful but adds taps); make Transactions the primary tab (strong for manual bookkeeping but de-emphasizes understanding and automation); use the five job-oriented destinations above (recommended). Transactions remains a direct segment inside Spending and preserves its independent route/deep links. Assistant is a presentation home for existing Chat, Activity and Automations, not a new agent or conversation.

## Page map and parity

| Current web destination/workflow | Proposed mobile home | Mobile treatment |
|---|---|---|
| Overview | Overview | Monthly spending first, then Cash and Net worth. Short coming-next list, recorded changes. Source/freshness details one tap away. |
| Spending | Spending → Summary | This week by default; preserve saved explicit preferences. Automatic budget-bucket/category grouping. Readable rows, amounts and a small chart. |
| Spending Bubbles / Trends / Rhythm | Spending → view picker | Retain visual exploration as intentional choices; no forced bubbles on a narrow screen. Same period, basis and filters across views. |
| Transactions | Spending → Transactions | Chronological grouped ledger; pending state, signed amount, account/category. Top-right view options, visible active chips. |
| Transaction detail | Pushed detail from any source | Amount/merchant first, then account, category, posted/pending, date, splits and evidence. Drill-down preserves exact contribution scope. |
| Categorization / splits / transfers | Transaction detail → edit/actions | Searchable canonical entities. Split totals must reconcile. Transfer pairing uses supported preview/matching APIs. |
| Reimbursements | Spending → reimbursements; linked transaction detail | Your share, expected repayment and received repayment stay separate. No assumed income from an expectation. |
| Bulk categorization | Transactions → Select | Explicit selection mode, selected count and bounded action sheet. Failed records stay selected. |
| Budget / plan / legacy budgets redirect | Plan → Budget | Applicable period’s approved plan, allocations, proposal and revision comparison. Full planning resources remain accessible. |
| Cash flow / subscriptions | Plan → Cash flow | Date-grouped upcoming agenda as default; income, bills and subscriptions as source lists. Calendar/forecast are alternate views. |
| Wealth | Plan → Wealth | Net worth, assets and debts, goals, investment/debt breakdown. Overview net worth deep-links here. |
| Scenarios | Plan → Cash flow or Wealth → Scenario | Label hypothetical; inputs and assumptions remain inspectable. Never mutate the real plan merely by exploring. |
| Goals | Plan → Wealth → Goal detail/editor | Progress versus target; confirmation/source basis retained. Goal-linked allocations accessible from Budget. |
| Accounts | Accounts | Grouped native list by account type. Real institution identity, masked account digits, balance currency and freshness. |
| Account configuration / duplicates / repair | Account detail | Ownership/inclusion, product type, source freshness and repair. Scoped filtering never changes financial totals. |
| Imports | Accounts → Add / Transactions menu | File selection, preview, explicit confirmation and recovery. Keep manual mode supported and gated by actual capability. |
| Ledger checks / corrections | Accounts → Data checks; contextual record links | Preserve scoped correction workflow, duplicate and mismatch evidence. |
| Chat | Assistant → Conversation | Existing ongoing conversation. Contextual questions include the exact linked record. Reply receipt is not financial execution success. |
| Review queue / decisions | Assistant → Reviews; attention shortcut where supported | Deep-link the existing canonical queue; do not create a second decision store or independently computed count. |
| Activity | Assistant → Activity; Overview What changed | Compact timeline of recorded actions, with changed records, explanations and original evidence. |
| Period review | Assistant → Activity → Period review | Readable summary with drill-downs to exact supporting data. |
| Automations | Assistant → Automations | Actual schedule/host/capability status, last run and recovery. No unsupported “always watching” claim. |
| Financial profile / setup | Assistant → Financial profile; workspace settings link | Resumable named sections, manual mode, prerequisites. Keep Chat visible with an honest reason when unavailable. |

## Screen hierarchy

### Overview

1. Existing compact workspace/search/account row.
2. Title and a single top-right options action.
3. Spent this month, applicable approved budget and basis/pending label. If no applicable budget exists, omit progress comparison and provide setup navigation. Never substitute today's budget into another period.
4. Cash and Net worth compact linked metrics. Show currencies explicitly when not all USD; no unsupported cross-currency sum.
5. Coming next: first three canonical expected occurrences, date, source, signed remaining amount. “See all” preserves the agenda range in Cash flow.
6. What changed: latest recorded maintenance/period review, linked to Activity. No repeated dashboard of metrics or invented all-clear.

Needs-input attention remains in the existing shared attention/review mechanism. The mockup’s Assistant tab illustrates its page destination. Do not fetch a second decision summary on Overview against the existing web contract.

### Spending

Summary / Transactions segmented control stays scoped to this tab. Period is always visible. Summary uses a readable category/bucket breakdown; choose alternate charts via one native view menu. Display the basis, total, pending inclusion and material incomplete-source qualifications; technical accounting provenance can be inspected in About these totals. Missing data is not $0.

Category tap opens category detail; contributing transactions retain the server’s exact reference. The prototype only demonstrates navigation; that reference wiring is native implementation work. Transaction detail and correction remain direct even when automated maintenance is disabled.

### Plan

Budget / Cash flow / Wealth are subviews, not more bottom tabs. Budget separates approved state from draft/proposed changes. Save creates/updates a proposal; **Approve budget** is a separate explicit labeled action reviewing the exact current revision. It must never become an unlabeled checkmark or be implied by Save. Future estimates, expected recurring money and recorded balances have distinct labels.

### Accounts

Prioritize reliable identity and source health over decorative physical cards. Only explicitly identified credit-card products get card treatment. No invented debit cards, networks, card numbers or issuer artwork. Source problems link to real repair. Opening an account retains back navigation and exposes scoped transactions and planning inclusion.

### Assistant

A short needs-input section, a direct entry to the existing conversation, then recent handled work and automation/profile links. Avoid a second generic chatbot dashboard. Questions, proposals, answers received, work pending and confirmed outcomes remain distinct. Manual users can inspect and correct records without enabling a host.

## Shared interaction system

- Keep Apple’s native bottom tab bar, filled selected glyphs in Finance green, neutral outlines, labels and system dragging/animation. The browser prototype uses opaque navigation placeholders; it does not recreate or validate native Liquid Glass.
- Stable search row and workspace switcher remain unchanged in the native shell. Tabs preserve their own navigation/filter/scroll state. No custom full-screen transition or loading flash.
- Reuse theme spacing: 20-point page inset, 16-point grouped surfaces, 4-point spacing scale, 44-point minimum touch targets. Dynamic Type grows rows.
- Content identity icons top-left; single action icon or multiple-action vertical ⋮ top-right. Settings rows center icon/label/value/accessory vertically.
- Reuse RecordIdentity and shared form sections. Account, Category, Budget bucket, Goal and other meaningful entity fields use their canonical icons in both trigger and choices. Add registry entries only where needed; never a new icon pack.
- Simple numbers edit inline; small finite choices expand inline; large entity collections use searchable pickers. Choice labels lead; selection checks trail. Apple date/time pickers, account timezone only.
- No More details/Show more hiding normal fields. All optional relevant fields are scannable in named sections. Placeholder values are realistic paired examples, never saved defaults.
- Create where meaningful through floating + (manual transaction, account, goal, recurring source). No universal Add on Overview/Assistant or destructive/recovery views.
- Close + disabled floating checkmark Save before edits; Cancel + discard confirmation after explicit edits. Validation/permission/conflict guards still govern Save. Retain drafts through recovery.
- Ordinary lifecycle actions first; destructive text AND icons red after a divider. Use the same semantic icon as the destination. No false Undo if the API cannot reverse the whole operation.
- Actual implementation uses shared AppToaster/Sonner: one loading-to-result toast, opaque contrast, stacking and authoritative Undo only where supported. Prototype feedback explicitly says no data was saved.

## State coverage before native release

Populated, empty, first-time setup, no budget, unavailable source, stale data, pending transactions, mixed currency, no search matches, long labels, large text, keyboard, light/dark/high contrast, reduced motion, owner switch, offline reads, save conflicts, uncertain writes, late refresh, interrupted navigation and denied capabilities.

Financial approval and uncertain mutation recovery require API integration tests and real native interaction checks. Browser screenshots cannot prove native gesture/glass acceptance. Connection refresh acceptance does not prove all balances were updated; notification scheduling does not prove banner delivery.

## Implementation order

1. Shared Finance screen primitives, entity dictionary and native five-tab registry; read-only Overview, Spending and Accounts against typed API.
2. Ledger drill-down and canonical forms; exact scoped contribution navigation, categorization and supported recovery.
3. Budget/Cash flow/Wealth with exact approval semantics, income/recurring sources and goals.
4. Existing conversation, review and activity evidence, then automation/setup/manual/import parity.
5. Cross-workspace accessibility/recovery pass, frozen candidate full verification, simulator/device evidence, then a new TestFlight build.

Reuse the Tasks shell/form primitives, but move shared primitives to common ownership before Finance imports them. Keep Finance meaning/calculations on the API, not in JSX. Use domain-owned hooks/adapters, small page compositions and shared financial row/amount/status components; avoid copying the large web page module into one mobile component.

## Sources inspected

- apps/web/src/features/finances/navigation.tsx and workspace-page.tsx — actual route inventory and redirects.
- Overview, Spending, Cash flow and Plan page source — composition and existing controls.
- docs/product/workspaces.md — Finance purpose, manual parity and authority.
- docs/design/pages/finances.md — current Finance experience, totals, planning and account identity contracts.
- docs/design/mobile-frontend.md and mobile-forms.md — canonical native behavior.
- apps/mobile/src/navigation/workspace-pages.ts and components/icons.tsx — current mobile scaffold and glyph registry.
- Apple HIG Tab bars: https://developer.apple.com/design/human-interface-guidelines/tab-bars
- Apple HIG Materials: https://developer.apple.com/design/human-interface-guidelines/materials

No repository standard was overwritten by this proposal. Durable adoption belongs in the canonical mobile/Finance documentation alongside the implementation after feedback.
