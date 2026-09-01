# ilo — Master Product & Experience Design

- Status: Living master design; shipped and future behavior are labelled explicitly
- Date: 2026-07-18
- Last reconciled: 2026-08-12
- Supersedes: the product direction in `docs/product/mvp.md` for future planning. The MVP remains the record of what has already been built.

## 1. Decision and intentional scope expansion

ilo will be a private, cross-device operating layer for an individual's commitments, communications, priorities, and money. It will sit on top of existing desktop and mobile operating systems and provider accounts; it will not replace them. A person operates the same material directly in the app or delegates bounded work to Claude, Codex, or another MCP client.

This design intentionally expands scope beyond the current MVP. The expansion is necessary to make safe automation usable: a permission prompt alone is not a workflow. Every automated mutation therefore needs a comprehensible UI path, a preview or rule policy, audit evidence, undo/recovery where possible, and a way to stop future runs.

There are no deferred product domains in this document. Delivery is phased for dependency and safety reasons, but the target product includes every capability named here.

## 2. Product promise

> At any moment, ilo shows what matters next, what is actively happening, what is realistically still possible today, and what an authorized agent did or proposes to do.

It must make the useful action easy for a person who wants a calm, low-information interface while retaining fast paths, search, keyboard access, automation, and inspection for a power user.

Each material workspace has an Ilo: a persistent expert steward that maintains the workspace's
living ledger, applies its approved rulebook, asks only for irreducible human judgment, learns from
explicit answers, and produces an evidence-backed review and recommendations. Clients express
intent; the workspace domain owns the expertise and durable workflow. The shared product doctrine
is [`Ilo workspace stewardship`](ilo-workspace-stewardship.md).

### 2.1 Target user and jobs

The primary user is an individual with multiple Google/iCloud accounts, variable attention and energy, a calendar that mixes work and life, an inbox that needs recurring cleanup, and existing Claude/Codex subscriptions. They want help without surrendering control.

| Job | Success outcome |
| --- | --- |
| Start and end the day | Know the next commitment, realistic remaining work, and completed work in seconds. |
| Process communication | See the few conversations that need attention, clear the rest safely, and leave a record of commitments. |
| Protect time | Make events, tasks, meals, breaks, travel, routines, and focus blocks fit together without exposing private details to work calendars. |
| Keep commitments | Capture, schedule, defer, complete, and review reminders/tasks without losing the source or reason. |
| Clarify direction | Connect goals, motives, and habits to the work that matters most. |
| Understand money | Know what changed, what is uncategorized, what is safe to spend, and what needs a decision. |
| Delegate safely | Give an agent just enough authority, see its intended and completed work, and revoke it instantly. |

## 3. Product principles and hard invariants

1. **One material, many views.** An email-derived task, event, reminder, and financial review item retain links to their original records. Views never create unsynchronized copies.
2. **Human control at the mutation boundary.** An agent may classify, summarize, suggest, and prepare a plan freely inside its scope. Sending mail, deleting/discarding content, moving money, changing attendance, or modifying a provider record requires the policy assigned to that action.
3. **Least privilege is legible.** Scopes are in plain language, grouped by material and action, and visible at creation, run time, activity history, and revocation.
4. **Progressive disclosure.** Today and Inbox lead with the next useful action. Rules, raw provider data, confidence, trace, and advanced configuration stay available in inspectors or settings.
5. **Plan with reality.** Deadlines are not calendar blocks. Every schedulable commitment records duration, flexibility, priority, energy/context preferences, and source of truth.
6. **Provider fidelity and reversibility.** Connected providers remain authoritative for their material. Local history retains IDs, revisions, raw payload references, actor, before/after state, and recovery instructions.
7. **No invisible automation.** Every run has an owner, trigger, version, input summary, tool calls, changes, failures, approvals, idempotency key, and terminal status.
8. **Privacy is a feature.** Mail, calendars, and finance can be individually excluded from agent context, exports, notifications, and desktop overlay surfaces.
9. **Consistent block system.** Use shared shadcn primitives and composable blocks; navigation and action placement do not change from screen to screen.
10. **Accessible on every surface.** Keyboard, screen-reader, reduced-motion, mobile, desktop, and high-contrast behavior are acceptance requirements, not follow-up work.
11. **A sync reset only resets projections.** A provider-required full resync may replace its disposable normalized projection and cursor, but never user-authored links, local annotations, approvals, rules, or immutable audit evidence.
12. **Untrusted content cannot authorize an action.** Mail bodies, event text, attachments, webpages, and imported content are data, not instructions. They cannot grant scopes, choose an external recipient, escalate a policy, or silently cause cross-domain disclosure.
13. **Unification is a graph, not a generic record.** Mail, calendar, commitments, and finance retain native models and source semantics. Typed links, annotations, search, activity, and Today create the unified experience without flattening provider behavior into lossy nullable fields.
14. **Every durable domain workflow has a viable manual and degraded path.** A runner, webhook, native widget, or paid connector may enhance an action, but cannot be its only recovery path. The user can inspect, pause, repair, complete, or defer work when that dependency is unavailable.

## 4. Information architecture

The persistent desktop sidebar is fixed-width and never collapses. On small screens it becomes an explicit sheet. Route-specific context uses the same sidebar region, replacing—not stacking beside—the app navigation when entering a focused material surface.

```
App
├── Today
├── Inbox
├── Calendar
├── Tasks
├── Reminders (legacy compatibility surface)
├── Tracking (planned)
├── Finances
├── Reviews
├── Activity
└── Account menu
    ├── Profile
    ├── Settings
    ├── Security & sessions
    └── Log out

Settings
├── Back to app
├── Personal: Profile, Appearance, Locale & time
├── Security: Sessions, recovery, privacy, exports
├── Workspace: Connections, calendars, mail, notifications, widgets
└── Agents: Connected agents, Workspace access
```

### 4.1 Shared chrome

- **Sidebar:** product identity, stable navigation, contextual material list, then account menu. Count badges are reserved for unread mail, overdue/due commitments, approvals, failed runs, and finance review items.
- **Top bar:** only global creation, exceptional system state, platform/overlay controls, and mobile navigation. It never repeats a screen title, date, or an action already present in the page header.
- **Page header:** route title and route-specific view controls. Calendar owns date, period, view, timezone, and visibility controls here; Inbox owns search/sync/filter here; Today owns no generic creation action.
- **Inspector:** non-destructive read, source identity, linked material, quick actions, history, and advanced fields. On mobile it is a bottom sheet.
- **Editor:** explicit create/edit sheet or dialog. Provider-sensitive values expose their outcome before save.
- **Command palette:** universal navigation, capture, search, and allowed actions; it respects the same scoped capability checks as API/MCP calls.

## 5. Shared material model

Every object has `id`, owner, origin/provider, creator/actor, timestamps, access policy, source links, sync/revision state, audit references, and soft-delete/recovery policy where supported.

| Material | Required fields and relationships |
| --- | --- |
| Account & connection | Provider, OAuth/app-password credential reference, capabilities, health, selected sources, sync cursor, writeability. |
| Mail conversation/message | Account/mailbox/labels, participants, headers, body/attachments safe representation, importance/category, thread state, provider revision, derived commitments. |
| Calendar/event | Calendar, organizer/attendees/RSVP, title, notes, location, conferencing, attachment references, start/end/timezone/all-day, recurrence, visibility, transparency, event type, travel/buffer relationship, source/block relationship. |
| Task List | Persistent organizational context; one protected system Inbox per person; normalized unique name, availability, local source, revision, and soft-deletion state. |
| Task Project | Finite outcome inside one List; lifecycle, availability, target date, notes, optional `why`, local source, revision, and explicit child-resolution behavior. |
| Task | One independently completable action; exactly one List, optional same-List Project, title, notes, optional `why`, priority, estimate, tags, independent deadline and reserved time, lifecycle, local source, revision, and recoverable Trash state. Recurrence remains future work. |
| Reminder | A currently separate lightweight actionable record and compatibility surface. The target model treats reminder delivery as a Prompt attached to a Task or Tracking check-in, but Prompt persistence and Reminder migration are not implemented. |
| Tracker / entry / goal | Planned Tracking material: versioned repeated observation, check-in, habit, entry, and evaluative goal contracts. None of these Tracking contracts is shipped by the 2026-08-12 Task foundation. |
| Finance | Institution/account, balance, transaction, merchant, category/tag, split, recurring stream, rule, budget, cash-flow forecast, goal, review state and confidence. |
| Domain profile | Domain, objective, source meanings, categories, durable instructions/preferences, status, and optimistic version. |
| Attention item | Domain, important/upcoming/follow-up/run-summary kind, importance, source/related material, lifecycle state, and optional occurrence/expiry. |
| Rule | Common version/policy/source/profile envelope plus a domain-owned condition and action contract. |
| Automation | Template, versioned instructions/skill, trigger, schedule/event trigger, inputs, scopes, policy, model host, state, run and approval queue. |
| Activity/audit | Actor, request/run, operation, entity, redacted before/after, remote request/revision, reversible action, result and failure data. |

## 6. Complete experience design

### 6.1 Onboarding, identity, and connections

1. Create account or sign in; persist session across refresh and device restart.
2. Set preferred name, primary timezone, locale, notification preference, brand color, and optional ilo name (for example, “Home OS”).
3. Choose a starting path: connect Google, connect iCloud, create local-only workspace, connect Plaid, or import later.
4. Google connection asks separately for Calendar read/write, Gmail read, Gmail modify/send, Gmail settings/filters, and optional contacts. Multiple accounts are supported, named, and independently revocable. The product discloses the verification/security-assessment implications before enabling restricted Gmail scopes or server-side storage.
5. iCloud connection prefers Apple Account authorization when the platform supports it and otherwise accepts an app-specific password through an encrypted credential flow. Mail and CalDAV calendar are independently enabled, discovered, health-checked, and designed for revocation when an Apple password reset invalidates app passwords.
6. Plaid uses Link, explains read-only access and data freshness, lets the user select institutions/accounts, and requires a finance-specific consent screen before the first sync.
7. Source selection lets the user include/exclude individual calendars, mailboxes, and financial accounts; it also defines busy-mirror destinations and notification privacy.
8. The finishing screen creates a private local calendar/reminder inbox, previews the generated daily brief, and clearly states that no agent has access until a token is created.

Failure UX: expired OAuth, app-password rejection, partial capability grant, unsupported provider, stale sync, duplicate account, and connector reconnection each retain progress, explain consequence, and provide one retry/reconnect action.

### 6.2 Today: the daily operating surface

Today is intentionally minimal. It is ordered by time and decision urgency, not source app.

```
Now
├── Active: events/tasks currently in progress; next transition and remaining time
├── Next: the single next hard commitment or chosen focus block
├── Remaining today: committed blocks, hard deadlines, and a short, feasible task queue
├── Needs triage: mail, finance, RSVP, approvals, and unscheduled commitments requiring a decision
├── Tomorrow / upcoming: only items worth preparing for
└── Done: collapsed by default; completed tasks, processed mail, and resolved review outcomes
```

- Calculate current time in the displayed timezone; show ongoing multi-hour and all-day events distinctly.
- Separate hard commitments from flexible work. Remaining capacity excludes busy events, protected meals/breaks, travel buffers, sleep/work-hour boundaries, user-reserved downtime, and the unelapsed estimate of each already reserved task; overlapping reservations are unioned so time is never counted twice.
- Capacity defaults to a visible, conservative 9 AM–5 PM local planning window; users can set its start and end under Profile. Meals, travel, buffers, sleep, and protected downtime remain explicit planning preferences to add next. The feature reports rather than rearranges material.
- Each task has an estimate; “plan my day” may schedule only within available capacity and must explain omissions/overload.
- Completion moves an item into Done without losing source or allowing accidental reappearance; reopening is available in the inspector.
- Goals appear as one or two relevant commitments rather than a dashboard. Motives/rewards appear only when useful for follow-through.
- The user can pin blocks, choose a focus task, defer items, start a focus timer, or ask an agent to prepare—not execute—a day plan.
- A desktop/mobile widget and docked overlay present Now, Next, urgent due count, and one capture action. They obey a separate privacy setting.

### 6.3 Mail: unified inbox and safe triage

**Views:** Unified inbox; account inbox; selected mailbox/label; search; categories; priority; needs reply; newsletters; notifications; invitations; sent/drafts/archive/spam/trash; saved smart folders; agent review queue.

**Workflow:**

1. User chooses Unified Inbox or an account. Account identity, mailbox, unread count, sync freshness, and provider capabilities remain visible.
2. Inbox groups messages by selected smart category without hiding chronological and all-mail views. Groups expand/collapse; saved views can filter account, sender, labels, dates, attachment, read state, event/invoice/receipt intent, and agent confidence.
3. Reading a thread exposes contextual actions: mark read/unread, archive, delete, move/label, star/priority, spam/not spam, snooze, create task, create event, extract receipt, unsubscribe, add follow-up, draft/reply/forward, and source links. Actions are provider-aware and disabled with a reason when unsupported.
4. Batch mode exposes the same actions, confirms destructive change count, supports undo where the provider permits it, and writes one auditable material action per affected item.
5. A triage session shows one category or bounded batch, with shortcuts and a visible “done for now” exit. Nothing is auto-archived just because it was read.
6. The agent can propose classifications, labels, archives, task/event drafts, unsubscribe candidates, or reply drafts. The person can approve one, approve a category/rule, edit, reject, or allow safe recurring application.
7. MVP Mail rules use exact deterministic conditions, explicit scope, dry-run results, effective
   date, undo/review behavior, and a kill switch; their shared-envelope confidence threshold stays
   null. Optional server-owned agent classification and scored confidence remain future scope.
8. Briefs cite source threads and distinguish “needs reply,” “FYI,” “deadline,” “event/invite,” “financial,” and “newsletter.”

Mail policy tiers:

| Action | Default policy |
| --- | --- |
| Read, search, summarize, classify | permitted when scoped |
| Apply label, mark read, archive low-risk newsletters | preview first; can graduate to rule-authorized |
| Spam, unsubscribe, delete, bulk move | explicit approval or confirmed per-rule policy |
| Draft | permitted when scoped; never sent automatically by default |
| Send/reply/forward | explicit approval per message or narrowly confirmed rule |

### 6.4 Calendar: time, collaboration, and protected availability

- Day/week/month/agenda views use Sunday-first locale-aware grids, 15-minute marks, exact current-time position, and Today snaps both vertically to now and horizontally to the current date.
- Calendar list is compact and source-based. Standard shadcn checkboxes, count, source color, account grouping, search, show/hide, and bulk visibility presets are persisted.
- Event editor supports local/provider calendar selection, all-day/timed duration, timezone, recurrence, visibility, free/busy, event type, location/map/travel time, conferencing, attachments, notes, reminders, attendees, and RSVP/organizer data.
- Drag, resize, keyboard movement, copy/move between writable calendars, and natural-language creation all show destination/time consequences and rollback provider failures.
- Incoming invitations have an RSVP workflow: accept/decline/maybe, optional response message, event updates, source mail link, and agent-prepared recommendation. External organizer changes surface as a conflict/update, never as a silent local overwrite.
- Availability finds windows across selected calendars while hiding private details. Scheduling links and proposals define duration, timezone, booking windows, buffers, location/video policy, invite policy, expiration, cancellation/reschedule behavior, and conflict avoidance.
- Busy mirroring is relational: one visible source event, one or more destination blocks, privacy mode (busy-only/details), loop prevention, revision reconciliation, and a single audit trail. Generated blocks do not duplicate the source in the unified canvas.
- Time-quality analysis finds no-meal intervals, insufficient buffers, travel conflicts, overload, meeting density, focus-time erosion, and time-zone conflicts. It proposes changes; it never silently rearranges non-flexible events.
- Flexible tasks, habits, focus blocks, meals, breaks, and buffers can be scheduled in an internal planning layer or written to a chosen calendar with explicit busy/privacy behavior.
- Calendar has search, saved calendar sets, focus/out-of-office types, widgets, desktop notifications, and overlay quick-open.

### 6.5 Tasks, Lists, Projects, and Reminders

The 2026-08-12 Task organization foundation is implemented. Tasks is one workspace at `/tasks`:

The [Tasks Ilo charter](./tasks-ilo-charter.md) defines how this living ledger and its shipped
surgical operations fit the workspace-stewardship model. It marks maintenance turns, questions and
learning, domain status, advice, and review artifacts as target behavior rather than claiming this
foundation already ships them.

- **Views** are queries and never own records: Today, Upcoming, Scheduled, Completed, Cancelled,
  and Trash. Scheduled means an open Task has reserved time; it is not lifecycle.
- **Lists** are persistent contexts. Every Task belongs to exactly one List. Each person has one
  protected system Inbox, and `/tasks` selects it without putting its generated ID in the URL.
- **Projects** are finite outcomes inside one List. A Task may belong to one Project in that same
  List. Projects and Lists do not nest.
- **Tasks** have only `open`, `completed`, or `cancelled` lifecycle. Deadline (`dueAt`) and reserved
  time (`scheduledAt`) are independent. Availability/Trash is separate from lifecycle.

Selection is linkable and canonical: `view` excludes `list` and `project`; a `project` implies its
`list`; a non-Inbox List uses `list`; Inbox is the parameter-free `/tasks` default. Ordinary
navigation includes only active Lists and active, open Projects. Container moves and terminal or
archive operations return exact conflicts or require revision-bound previews rather than silently
detaching, completing, hiding, or stranding work.

Task create/edit supports List, optional same-List Project, title, notes, `why`, priority, estimate,
tags, deadline, and reserved time. Lifecycle, Trash, and restore are focused actions outside the
content form. Natural-language classification, Task recurrence/occurrences, attachments, bulk
editing, Prompt persistence, time-block synchronization, and focus mode remain future work.

Reminders remain a separate lightweight compatibility domain and `/reminders` surface today. The
approved target is to model a reminder as delivery behavior attached to a Task or Tracking
check-in, but ilo must preserve standalone Reminder behavior until Prompt persistence and a reviewed
migration exist. Shared storage does not make Reminders and Tasks one domain.

### 6.6 Tracking, goals, motives, and habits

Tracking is the approved sibling workspace for repeated observations, habits, check-ins, and
personal measurements. It is a personal ledger, not a wellness or diagnostic product. Habits are
Tracker configurations; food, sleep, exercise, ratings, and other observations use general typed
tracking primitives rather than dedicated verticals. Goals are evaluative targets that may link to
Tasks or Trackers without containing them. Immediate motivation belongs in an optional `why`;
broader preferences belong in the person's profile.

The Tracking workspace, tracker/entry/check-in/goal persistence, classifier, recurrence, Prompt
delivery, and migration of current Goals/Motives are not implemented. Their normative target and
research basis live in the two 2026-08-12 Tasks and Tracking specifications.

### 6.7 Finances

- The Finance Ilo combines the useful methods of a bookkeeper, accountant/controller, financial
  planner, investment analyst, auditor, and coach. Its maintenance turn reconciles and classifies a
  selected period, balances it against budgets and goals, updates income/recurring/cash-flow/wealth
  models, isolates questions, learns only explicitly approved rules, and publishes a period review.
- Connect Plaid-supported institutions and selected accounts; show connection health, consent, refresh time, duplicate detection, data removal, and the connector's production-cost state. Manual accounts and CSV/OFX import remain first-class so budgeting and review do not require a paid connector.
- Normalize balances, pending/posted transactions, transfers, merchant, location, category confidence, recurring inflow/outflow, account type, investments, liabilities, and manual transactions.
- The daily finance queue is: new/uncategorized, low-confidence, split-needed, suspected transfer, recurring/subscription change, unusual spend, bills due, and review-complete. It is never mixed into Today unless it requires a decision.
- Categorization uses provider categories, deterministic merchant rules, and agent suggestions. The user can correct one transaction, apply a rule to matching future items, split transactions, exclude/transfers, tag projects, and review all changed history.
- Budgets support category, flexible, envelope/zero-based optional modes, rollovers, targets, recurring bills/income, cash-flow forecast, safe-to-spend/left-this-month, savings goals, watchlists, net worth, investments, subscriptions, and reports.
- The agent may explain and propose categorization/review work under a finance-read scope. The
  Finance Ilo may provide evidence-backed informational planning, budget, savings, investment, and
  market-context recommendations within the product's approved advisory model. It cannot transfer
  money, trade, pay a bill, file a return, or claim a human professional credential.
- Pending and posted transactions are separate states. Pending categorization is provisional, cannot create durable merchant rules or definitive budget/"safe to spend" claims, and must reconcile against provider removals/replacements before becoming settled data.
- Finance data uses stronger consent, redaction, retention, export/delete, no-notification-content defaults, an explicit warning before sharing with an agent, and a visible last-refresh/provider-freshness indicator.

### 6.8 Agent controls, Reviews, and activity

**Guided setup:** after connecting sources, the Ready step and Settings → Connected agents provide the deployment's remote MCP URL. Hosted OAuth with plain-language consent is primary; scoped personal tokens are an advanced local fallback. Settings → Workspace access then explains the actual read, write, approval, source-scope, and unavailable boundaries for Mail, Calendar, Tasks, and Finances while supervising one server-owned setup plan. After authentication the agent calls `get_ilo_setup`, which returns the current semantic step, observed evidence, exact scope, required tools, domain instructions, and approval boundary. The agent reads any existing profile, inspects a bounded representative sample, asks only unresolved questions, saves a draft, previews consequential behavior, and calls the plan again after every save or signed-in approval. The person handles only the unavoidable connection, genuine preference decisions, and consequential approval. A versioned Ilo-hosted `ilo-setup` skill remains an optional compatibility reference, not a required install or parallel source of completion state. Personal preferences live in Ilo rather than in a host skill or conversation memory.

Domain profiles use one shared envelope for objectives, source meanings, categories, durable instructions, preferences, status, and version. Attention items use one shared envelope for important, upcoming, follow-up, and post-run summary material. Rules share version, policy, profile/source selection, confidence, and enabled state while retaining domain-owned conditions, actions, validation, and execution.

**Token/scopes:** new credentials use domain read/write scopes plus audit and bookmark reads. `automations:read` remains a compatibility label for reading the daily brief. `automations:write` is inactive and unavailable on new tokens. Workspace permissions currently apply at the workspace level except where a provider-selected destination is explicitly enforced; the UI must not invent per-source credential controls.
Planned Tracking adds `tracking:read` and `tracking:write` with selected Tracker sources; those scopes are not shipped yet.

**Reviews:** `/reviews` is a Today-owned operational destination containing only review and attention work. Kind and workspace filters are URL-owned, results are cursor-paginated, and every action routes to the domain that owns the decision. Setup and access configuration never appear as queue work.

Ilo does not publish a generic routine catalog, routine-run API, or routine scheduler. Durable background behavior is domain-owned—for example, reviewed Mail rule work—and must expose domain-specific pending, success, reconciliation, and failure state.

The Activity view filters by material, actor, source, result, date, and reversible state. Every event links to the affected material and source evidence.

### 6.9 Desktop overlay, widgets, notifications, and mobile

- Tauri desktop shell for macOS/Windows supports compact, pinned, always-on-top, click-through-disabled interactive modes, global shortcut, docked sprite/pet, and full-app deep links.
- The sprite has idle, open, unread/pending, error, and reduced-motion states; click opens a compact ilo panel and click/shortcut closes it. It communicates urgency through a count/quiet animation, never through inaccessible motion alone.
- Widgets on desktop and mobile show selectable blocks: Now/Next, due tasks, unread triage count, finance reviews, habit prompts, and compact calendar. Widgets show private-safe summaries unless the user opts into detail. Apple widgets use a native WidgetKit extension, shared container, and timeline/push update model; Windows widgets use a Windows widget provider/PWA-specific Adaptive Card adapter. Widgets are glanceable deep-link surfaces, not a second full application, a source of high-sensitivity content, or a real-time alert guarantee; notifications carry time-critical delivery.
- Notifications use a per-domain policy, quiet hours, time zone, device selection, escalation/reminder behavior, and source privacy. Calendar/reminder notifications respect platform permissions and are de-duplicated across devices.
- PWA and native shell preserve core actions offline, visibly queue local changes, reconcile provider material on return, and show conflict/resolution UI.

## 7. Automation safety and policy engine

### 7.1 Policy vocabulary

- **Allow:** execute without interruption within scope.
- **Preview:** produce proposed changes only.
- **Approve each:** require one approval per material action.
- **Approve batch:** require confirmation of a bounded homogeneous set.
- **Rule-authorized:** execute only when a user-created rule, conditions, sources, and confidence floor match.
- **Blocked:** neither human shortcut nor agent token may perform it through that route.

Policies are evaluated by API/domain service, not by web or MCP clients. The policy decision, matching rule, and current scope are audited for every attempted action.

### 7.2 Mandatory safeguards

- Dry run with exact candidate set and predicted mutations.
- Idempotency keys for provider and internal writes; retries never duplicate messages/events/actions.
- Optimistic concurrency on provider revisions and explicit conflict choices: reload, keep remote, retry merge, or create local draft.
- Per-run rate limits, circuit breakers, emergency stop, source/account off switch, and kill switch for each rule.
- Immutable redacted audit record plus secure operational log; no credentials or full mail body in general logs.
- Undo/restore when provider/material permits; otherwise clear irreversible-warning and recovery instructions.
- Approval expiry, notification, reassignment, and no silent timeout-to-allow behavior.
- A content-origin label accompanies tool results and agent context. Any action that can send/share data externally, alter a sensitive provider record, or traverse into a new domain is a high-risk sink: it must be blocked from recipient/parameter selection by untrusted content and show the exact final payload, recipients, sources, and policy reason at approval time.

## 8. Architecture and integration design

The API remains the only domain boundary. Web, desktop, widgets, workers, and MCP use typed API contracts; no client calls providers directly.

```
Web PWA / Tauri / Widgets / MCP hosts
              │ scoped session or PAT
              ▼
API + Domain policy engine ──► Postgres + encrypted credential store + audit
              │                         │
              ├──► job queue/worker ────┤
              ├──► notification service │
              └──► Google / iCloud / Plaid / future provider connectors
```

- Mail retention is the first domain-owned durable execution implementation: stable work identity,
  bounded scheduler claims, lease recovery, exact provider reconciliation, terminal state, and
  redacted audit/attention observations. Other recurring domains still require a shared durable
  job queue, scheduler, worker lease/heartbeats, dead-letter handling, and run/event store before
  enabling real recurring automation.
- Model native domain records separately and expose a typed material-link/source-reference graph above them. A link carries relation type, source reference, ownership, revision/reconciliation state, and policy/audit references; it never makes a provider record and a local note falsely interchangeable.
- Maintain provider-neutral connectors with capability discovery. Google uses incremental OAuth and Gmail write scopes only when needed; iCloud uses IMAP/CalDAV and app-specific passwords; Plaid uses Link, webhook/sync cursor, and transaction enrichment.
- Add connector contracts for mail mutations, calendar RSVP/availability, attachments, finance transactions/rules, notification targets, and platform widgets. A capability matrix prevents unsupported controls from appearing enabled. Gmail "delete" means move to Trash unless a provider offers a separately scoped reversible behavior; permanent deletion is never implied by an archive/triage shortcut.
- Build normalized projections with remote ID, version/etag, original timezone, raw encrypted/provider payload reference, and tombstone state. Webhooks are hints; sync is idempotent reconciliation.
- Store agent skill templates/versioned instruction packs in the repository and product database registry. A routine records the exact version used for each run.
- Streamable HTTP MCP is an OAuth 2.1 protected resource with protected-resource metadata, audience-bound tokens, incremental scopes, and server-side validation. Local stdio can use a short-lived, revocable environment credential; neither transport trusts client-supplied tool annotations or policy claims.
- Model data classification and encryption keys per material domain; finance requires stricter export/log/context gates.

## 9. Design system and interaction specification

- Use generated shadcn primitives first: Sidebar, Button, Card, Field, Item, Input, Textarea, Checkbox, Switch, Tabs, Dialog/Sheet, Popover, DropdownMenu, Command, Tooltip, ScrollArea, Table, Calendar, Alert, Badge, Skeleton, Sonner, and DataTable patterns where applicable.
- Use Plus Jakarta Sans for UI and DM Mono only for compact time/date/identifier metadata. The default control height is 36px; default text is 14px; shared semantic tokens own primary/accent theme color.
- User color selection updates the semantic primary **and** accent tokens in all surfaces, including widgets and overlay; no hard-coded yellow or feature-specific brand colors.
- Account color is applied at the document root so portals inherit it. Selected navigation, dropdown choices, tabs, toggles, checked controls, and focus rings consume the shared selection or primary tokens; overlays may never fall back to a default accent.
- Appearance preference is account-scoped and offers System, Light, and Dark. System follows `prefers-color-scheme` as it changes; the resolved mode applies at the document root through the same semantic shadcn, sidebar, and application-surface tokens, never through feature-local overrides.
- The visual system is intentionally flat and recessive: use solid, predominantly monochromatic tonal surfaces; no gradients, decorative textures, or elevation shadows. Establish hierarchy through spacing, typography, and clearly different surface tones rather than pervasive hairline borders. Keep borders for controls, focus, and structural boundaries where they materially improve comprehension.
- Native desktop shells may use a restrained semi-transparent outer surface so the product can recede into the operating system. This is an outer-window treatment, never an excuse to blur the interface: dense material canvases, forms, overlays, sensitive content, and error states stay opaque enough for reliable contrast. Reduced-transparency and high-contrast modes retain the same hierarchy with solid surfaces.
- Cards are blocks with `CardHeader`, `CardContent`, optional `CardAction`, and `CardFooter`. Dense material canvases (calendar, mail list) are not gratuitously carded or rounded.
- Repeated rows reserve their action slot even when an action is unavailable. Long names truncate without moving siblings; destructive actions are separated and never wrap unpredictably.
- Every state has loading, empty, error, offline/stale, permission-denied, pending, and success/undo behavior. Keyboard equivalents accompany drag/drop and gesture interaction.
- Calendar and timeline interactions use 15-minute snap with a visible drop guide. No animation may shift sidebar geometry. Reduced-motion disables nonessential overlay/pet animation.

## 10. Accessibility, privacy, and quality requirements

- WCAG 2.2 AA, full keyboard traversal, visible focus that is not obscured by chrome/sheets, semantic headings/landmarks, labels, screen-reader announcements for async changes, target-size minimums, color-independent state, and locale/timezone-aware forms. Drag-only interaction is prohibited; keyboard/form alternatives are required.
- Test desktop, narrow desktop/tablet, mobile web/PWA, macOS shell, and Windows shell. Test multiple accounts, no accounts, long names, provider failure, stale data, read-only material, all policy tiers, and offline reconciliation.
- Encrypt credentials and sensitive application material at rest; redact logs; provide per-domain export, delete, agent-context, notification-preview, and retention controls.
- Support user data portability: export source-linked tasks/reminders/goals/automation audit, delete or disconnect providers, revoke tokens/sessions, and verify data-erasure progress.

## 11. Product measures and research plan

Measure each release with opt-in, privacy-preserving analytics and qualitative testing.

| Outcome | Measures |
| --- | --- |
| Calm daily orientation | time to identify next action, Today task completion, overload warnings acted on, SUS >= 80 |
| Trusted automation | preview-to-approval rate, rule reversal rate, unexpected mutation reports, revoke/stop success |
| Mail effectiveness | triage completion time, archive/label undo rate, false-positive category/rule rate, unresolved reply count |
| Schedule health | protected meal/buffer/focus completion, conflict rate, manual rework after scheduling suggestion |
| Goals and habits | goal/habit follow-through and review completion; never infer wellbeing claims |
| Finance confidence | categorization acceptance/correction, recurring detection correction, review queue age, budget comprehension |

Before each high-impact domain release, test 5–8 representative users on the happy path plus one failure path. Critical tasks must reach >=85% completion, and policy/conflict tasks require 100% comprehension in moderated tests before default enablement.

## 12. Explicit anti-goals

- Do not become a replacement email provider, bank, payment service, clinical therapy product, or general-purpose autonomous agent platform.
- Do not copy provider data into unlinked local clones or ask an agent to screen-scrape the UI.
- Do not hide automation behind “AI did it” language. Evidence, policy, source, and recovery must remain inspectable.
- Do not use gamification, notification volume, or urgency theater to exploit attention. Motives and rewards are optional and controlled by the user.

## 13. Source references

The research basis is recorded in the 2026-07-18 product analysis. Key experience references include [Shortwave automation](https://www.shortwave.com/docs/guides/customize-your-shortwave-settings/), [Spark Smart Inbox](https://sparkmailapp.com/help/manage-your-inbox/customize-your-inbox), [Notion Calendar availability](https://www.notion.com/en-us/help/availability-blocking-and-time-zones?nxtPslug=availability-blocking-and-time-zones), [Fantastical MCP permissions](https://flexibits.com/fantastical/help/fantastical-connector-mcp-for-claude), [Reclaim planning](https://help.reclaim.ai/en/articles/6210740-features-in-reclaim), [Plaid Transactions](https://plaid.com/docs/transactions/), and [n8n execution history](https://docs.n8n.io/workflows/executions/all-executions/).
