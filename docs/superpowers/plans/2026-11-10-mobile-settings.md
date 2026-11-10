# Mobile Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace native Settings placeholders with complete, API-backed mobile Settings, including personal tools, and deliver the verified result through normal TestFlight release.

**Architecture:** Settings is an account utility entered through the account menu, not a fifth workspace. A grouped searchable root list branches into native-stack detail pages; Settings has no bottom app bar. The mobile client shares typed API/domain contracts with web while reusing native mobile controls, identity, feedback and form components.

**Tech Stack:** Expo Router native stacks, React Native, Expo UI SwiftUI/UIKit bar items, existing TanStack Query/auth/API client, existing domain services, Sonner Native.

**Spec:** User instructions on November 10, 2026: include personal tools; release after all gates; no Settings app bar; grouped top-level links with tree navigation, following Apple Settings and existing mobile standards. Canonical references: `docs/design/pages/settings.md`, `docs/design/mobile-frontend.md`, `docs/design/mobile-forms.md`, `docs/product/workspaces.md`, `docs/engineering/external-boundary-reliability.md`.

**Tracking:** COO-211 — Mobile Settings; Nohmi project. Plan approved; execution intake underway. All subagents are capped at Sol Light (gpt-6.1-sol, low reasoning), including reviewers.

## Global constraints

- User-facing product name is `nohmi`. Existing native workspace tabs remain system-owned.
- No Settings bottom tabs. Root is a list of top-level destinations; children use Back. Account, workspace and agent menu entry points deep-link into that tree.
- Share server records and permissions with web. Do not invent mobile-only copies of profile, personal records, preferences or authority.
- Preserve unrelated dirty changes. Reconcile the pending Today/Finance release and Mail/refinement changes before choosing the release base. Never blindly commit all dirty files, rebuild an unchanged signed artifact, or duplicate an upload.
- Settings categories use native grouped rows with centered icons/labels/values, concise labels, useful example placeholders, domain identities, normal theme spacing and accessible touch targets.
- Native Liquid Glass belongs to navigation and action controls. Reading/writing surfaces stay solid. Use current shared `editorDismissOptions`, `editorActionOptions`, `SheetHeader`, settings rows and entity pickers.
- Preserve settings save semantics: simple independent preferences autosave; dependent profile/record edits use explicit Save, Close before edits, Cancel plus discard confirmation after edits. Successful background autosaves are silent; errors and discrete action outcomes use Sonner.
- Yellow values need attention; red means incorrect. No inline action-result banners. No fake success, empty-success failures or dead destinations.
- One user planning timezone, managed in Profile; no record-specific timezone fields.
- Never alter real personal records, connect/disconnect providers, revoke real sessions, grant agent access or send mail/texts merely to QA. Use isolated fixtures and read-only personal-account checks.
- Unsupported desktop features are excluded from iPhone navigation rather than represented as working controls. Do not make unsupported notification/background-delivery promises.
- Authorization includes normal protected merge/deployment/TestFlight after all applicable gates. No CI bypass, waived coverage or automatic retry of uncertain external mutations.

## Source inventory and proposed tree

Observed web navigation is in `apps/web/src/app.tsx` (`settingsNavigation`, `secondarySettings`). Field/search inventory is in `apps/web/src/features/settings/settings-fields.ts`; route relationships in `settings-routes.ts`. Mobile root/pages/agents are currently placeholders with four Settings tabs.

Root list, with group headers (not extra category pages):

| Group | Top-level links | Children / native treatment |
| --- | --- | --- |
| Account | Profile; Connections; Security & Access; Activity Log | Profile planning context/setup; connection detail/reconnect; devices, workspace access, eligible invitations; bounded recent audit detail |
| Personal | Goals & Motives; Rituals | Goal/motive detail/create/edit, completed outcomes; morning/evening configuration and history/detail |
| Workspaces | Tasks; Mail; Calendar; Finances | Domain preferences, notification links, guidance and supported domain configuration; reuse existing working mobile editors |
| Intelligence | Agents | Existing agent identities/connections, workspace guidance and execution policy; preserve server permissions and explicit confirmations |
| App | Appearance; Notifications; Texting; About | Supported device appearance, native notification permission/state and domain links; existing texting setup/consent only; version/build and support links where real |

Desktop App, desktop wallpaper and desktop pet controls remain desktop-specific. Shared ritual configuration/history is included; implementing a new iOS ritual runner or background engine is not implied. Texting configuration is included, not a new SMS conversation workspace. Finance financial goals and personal Goals/Motives retain their distinct domain models.

At implementation intake, enumerate every visible web field/action and classify: native shared setting; native device setting; desktop-only; role-gated; unsupported external capability. Record exact API method, validation, persistence timing, native consumer, source file and acceptance case. Anything not implemented must be explicit in this matrix; no silent parity omissions.

## File ownership / structure

- `apps/mobile/src/features/settings/navigation.ts`: destination registry, grouping, search metadata and capability gates.
- `apps/mobile/src/features/settings/home.tsx`, `settings-row.tsx`, `settings-search.tsx`: root list, shared compact setting composition, non-mutating search/deep links.
- `apps/mobile/src/features/settings/data.ts`: owner-scoped query keys and serialized preference save/recovery helpers; avoid one generic service swallowing domain contracts.
- Domain screens under `features/settings/`: profile, connections, security, activity, workspaces, agents, appearance, notifications, texting, about. Split further only where workflows justify it.
- Personal record screens stay domain-owned under `features/goals/` and `features/rituals/`; Settings only routes to them.
- `apps/mobile/src/app/settings/`: move Settings outside workspace chrome into native stack routes. Preserve old paths as redirects where needed; update `navigation/workspace-pages.ts`, account menu and shell routing so no Settings appbar remains.
- `packages/api-client/src/features/` and existing API/domain owners: reuse first; add narrowly typed missing adapters only after checking existing authenticated endpoint contracts. Never bypass the API.
- `docs/design/mobile-frontend.md`, `mobile-forms.md`: durable navigation/settings decisions; nearest engineering doc for native auth/permission boundaries.
- `.context/mobile-settings/`: parity matrix, test receipts, screenshots, release checkpoints. Do not store credentials or private content.

## Implementation sequence

### Task 1: Source/ownership baseline and native tree
- [ ] Record current branch, dirty file ownership, release checkpoints and latest native build; isolate Settings changes without losing the newly refined shared components.
- [ ] Build the field/action parity matrix from web implementation and typed API. Verify role gates and mobile platform support before coding destinations.
- [ ] Add navigation/search tests: every destination resolves; account/workspace/agent entry points land correctly; Back returns to the invoking context; search never mutates; no Settings tabs.
- [ ] Implement native stack root and grouped links using real destinations. Keep unfinished entries out of user-visible builds until their screens work.
- [ ] Verify root/detail/Back in simulator; review and checkpoint the bounded slice.

### Task 2: Shared settings mechanics and Profile
- [ ] Test account isolation, independent autosave serialization, stale revision conflicts, retained invalid drafts, explicit form Close/Cancel/Save and relaunch persistence.
- [ ] Implement reusable preference rows and explicit record editing using existing mobile primitives; do not add a second toast or glass abstraction.
- [ ] Port profile identity and actual web-supported planning context/location/timezone fields. Preserve multi-step verification flows and consent; no automatic verification requests.
- [ ] Validate web/mobile read-after-write consistency against synthetic data; inspect keyboard, picker search, long values and disabled actions.

### Task 3: Connections, Security and Activity
- [ ] Map connection state, provider brands, capabilities, retry/reconnect and named disconnect confirmation to actual endpoints.
- [ ] For native provider authorization, verify supported browser authentication session, redirect registration, cancellation, return-to-app and recovery. Use an explicit authenticated web handoff only where native setup is unavailable; never present it as completed native setup.
- [ ] Port signed-in devices and server-authorized access/invitation controls. Test current-session logout/revocation behavior with fixtures, not the user's session.
- [ ] Port Activity Log/detail (latest 100, matching the existing API; honest bounded history) with honest timestamps, actor/action identity and no sensitive payload leakage.
- [ ] Test expired auth, role denial, unknown provider, interrupted reconnect and stale data. Retain safe cached content and useful recovery.

### Task 4: Workspace and Agent settings
- [ ] Inventory and port Tasks, Mail, Calendar and Finances preferences and guidance; reuse Tasks preferences and Finance editors rather than duplicating them.
- [ ] Separate shared preferences from desktop-only presentation settings. A visible preference must have a meaningful supported consumer; otherwise explicitly classify it as shared/other-device configuration.
- [ ] Preserve typed revision checks, account selections, workspace notification ownership and the existing Finance approval boundary.
- [ ] Implement agent identities/connections/policy screens against existing contracts, with bounded actions, scope visibility and explicit confirmation for consequential changes.
- [ ] Test cross-workspace invalidation, concurrent web updates, read-only accounts and authority changes; no UI may silently broaden agent privileges.

### Task 5: Personal tools: Goals, Motives, Rituals and history
- [ ] Map exact web goal/motive lifecycle, relationships, progress and completed-outcome APIs; implement native lists/detail/forms using existing entity/tag/identity/action conventions.
- [ ] Preserve completion semantics; Goals/Motives deletion is permanent with named confirmation because no archive/trash/undo API exists. Keep Finance goals separate.
- [ ] Port morning/evening ritual configuration and actual history/detail from server contracts; expose only supported actions, preserving user timezone and step semantics.
- [ ] Test empty/populated/completed history, long content, missing related records, form discard, rejected changes and stale updates.
- [ ] Verify the full personal-tool flows in the simulator with realistic synthetic fixtures; do not claim ritual execution or background delivery from configuration success.

### Task 6: App settings and end-to-end integration
- [ ] Implement supported appearance choices with correct device-versus-shared persistence; default to system appearance.
- [ ] Reuse native notification permission/status and existing Tasks reminder implementation; global state links to domain controls. Test denied permission, OS-settings return, scheduling failure and honest test-notification feedback.
- [ ] Port supported Texting configuration, consent and phone verification using existing APIs. Do not send a real code/text as automated QA.
- [ ] Wire Today missing timezone/location, Mail reconnect, account menu, workspace settings and agent settings to their exact working destinations.
- [ ] Add real version/build About content; remove placeholder/dead links. Complete and reconcile every parity-matrix row.

### Task 7: Visual acceptance, review and release
- [ ] Check every implemented screen/form in light and dark, small/large text, narrow width, keyboard open, long identities, empty/loading/error/retry, unsaved drafts, native Back and interactive dismissal.
- [ ] Verify native glass label widths/contrast; inline row alignment; controls at least 44-point targets; screen-reader names/order; yellow attention/red errors; no hidden Save or nested navigation traps.
- [ ] Run focused tests during iteration; independent correctness, mobile-experience and external-boundary/release review before freezing source. Address all actual feedback.
- [ ] Follow repository create-pr/handoff/delivery verification workflows; obtain complete required local or equivalent hosted verification on the frozen candidate, with unchanged coverage floors.
- [ ] Normal protected merge; exact-main CI and normal production-controller/API/web/MCP health/provenance acceptance for any backend/shared changes.
- [ ] Reconcile existing App Store Connect builds/checkpoints. Allocate the next unused build number, verify signed production API origin/source/tree, archive and upload once, reconcile processing to actual Internal Preview Testing.
- [ ] Report tested scope, explicit platform exceptions, screenshots and installable version/build. Keep any parity/iPhone acceptance gaps tracked; never mark completion merely because upload started.

## Review focus and owning tests

1. A preference changed on web while iPhone is editing must not be overwritten by a stale whole-object save — Tasks 2/4 concurrency tests.
2. An expired session or revoked role during a security/agent action must retain safe drafts and reject unauthorized commits — Tasks 3/4 auth transitions.
3. OAuth, permission or phone verification interrupted by backgrounding must return to honest pending/retry state — Tasks 3/6 native boundary tests.
4. A missing related goal/list/calendar or partial history page must not look like successful empty data — Tasks 4/5 partial-read and pagination tests.
5. Large text/long labels with keyboard must preserve native dismissal, selected values and Save access — Task 7 native simulator/accessibility matrix.

## Execution and approval checkpoint

Product scope and TestFlight intent are confirmed. Navigation tree/no-appbar is explicitly approved. Recommended execution: bounded implementation subagents for independent domains after the shared shell/contracts stabilize, with parent integration and independent review; shared files have one owner. The user approved implementation subagents with review, then capped every subagent at Sol Light. Execute continuously under that cap; no further routine plan or release confirmation is needed. Release gates remain mandatory.
