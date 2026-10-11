# nohmi per-workspace settings

- Status: Accepted target product contract
- Last reconciled: 2026-10-08

## Purpose

Each workspace needs one understandable place to define how its sources, steward, maintenance
turns, agent access, notifications, questions, and recovery should behave. Settings should let the
person describe their preferred workflow in ordinary language and inspect the explicit
configuration and proposed rules nohmi derives from it.

Per-workspace settings change how a workspace operates; they do not create a separate version of
its data, expertise, policy engine, or User Knowledge. The same settings apply whether work begins
in the first-party app, public API, MCP, an external scheduled task, or the general SMS inbox.

## Settings layers

| Layer | Owns | Does not own |
| --- | --- | --- |
| Global account | Review bypass, shared notification policy, channel delivery defaults, connected agents, security, and privacy defaults | Domain meanings or workspace-specific instructions |
| Workspace | Sources, source meanings, maintenance behavior, explicit communication overrides, workspace privacy, and active guidance | Global identity, agent scopes, or hard safety limits |
| Rule | One explicit reusable condition, action, sources, exceptions, and policy | General personal context or broad prose instructions |
| User Knowledge | Goals, priorities, relationships, preferences, constraints, habits, and learned patterns | Action authority or external mutation rules |

## Surface ownership

Every setting has one canonical editing surface. Workspace-owned settings live inside the owning
Mail, Tasks, Calendar, or Finances workspace; they do not also become editable forms in centralized
Settings. Each workspace's settings entry opens the same calm section model defined below and may
deep-link directly to one source, rule, override, review, or recovery control.

Centralized Settings owns account-wide identity, security, privacy ceilings, review bypass, shared
notification policy, channel connections and defaults, connected-agent credentials and scopes,
User Knowledge controls. It also provides a cross-workspace overview
of source health, maintenance readiness, external check-in health, effective notification state,
override presence, and outstanding review counts. Workspace-owned values in that overview are
read-only summaries with links to their canonical workspace editors.

This boundary prevents two forms from drifting over one setting while preserving one place to see
the whole system. Global values may show which workspaces inherit or override them; changing a
workspace override still happens in that workspace. Reviews uses one shared, workspace-scoped
dialog/drawer, opened from the workspace attention alert or the action beside its Settings title.
Today and centralized account summaries do not add a separate queue link. Review actions retain
the owning workspace’s domain context and authorization.

## Agent-managed settings

The target MCP surface should expose every meaningful first-party setting through typed,
capability-specific tools. An appropriately scoped agent may perform requests such as “turn off
texting,” “disable email delivery for this notification,” change a workspace's maintenance guidance,
or update a channel preference without requiring the person to reproduce the change in the app.
MCP parity means functional coverage, not a generic unrestricted settings document or direct
database access.

Connected-agent controls live beside global review bypass so the person can understand automation
authority in one place. Permissions distinguish settings read, global notification/channel changes,
workspace configuration, rule management, data actions, and higher-impact account or policy
changes. An agent can use only the permissions granted to its credential, cannot change its own
credential or scopes, and cannot turn a general settings permission into authority to weaken a
stronger approval, privacy, security, provider-consent, or account-ownership boundary. Every change
is revision-guarded, audited, immediately attributable to the agent, and reversible when the setting
supports restoration.

Fine-grained controls over which workspace records or User Knowledge categories may be disclosed to
each external model host's context are planned but explicitly deferred. They should eventually make
model-context disclosure visible and configurable per connected agent without interrupting every
tool call, but the first agent-settings target relies on credential scopes, purpose-limited API
results, and existing privacy boundaries. Do not block useful app/API/MCP settings parity on this
later control layer or describe it as shipped.

## Shared workspace sections

Every Mail, Tasks, Calendar, and Finances settings surface should use the same conceptual sections
while presenting domain-specific controls:

- **Sources and synchronization:** connected providers, selected sources, meanings, destinations,
  capabilities, freshness, failures, retries, and removal.
- **Maintain:** whether the workspace accepts maintenance, its default bounded scope, its declared
  external cadence and last observed check-in, the current definition of maintained, and custom
  maintenance guidance. Schedule creation and editing remain in the external platform.
- **Questions and reviews:** open work nodes, answer behavior, review history, and the inherited
  global review-bypass state.
- **Texting and notifications:** whether this workspace participates in the general SMS inbox,
  which maintenance outcomes it sends, reply behavior, content detail, links, quiet hours, and
  other supported channels.
- **Rules and learned behavior:** active rules, proposals, exceptions, recent learning, confidence,
  provenance, promotion, disablement, and rollback.
- **Privacy and agent access:** allowed purposes, sensitive content, cross-workspace disclosure,
  connected-agent visibility, and links to the global scope controls.
- **Recovery and data:** connector repair, failed or interrupted runs, exports, retention, and
  deletion or disconnection consequences.

Every question, approval, connector failure, or recovery step that requires the person also appears
in that workspace’s shared Reviews flow. Informational and automatically recoverable states stay
in workspace status or activity rather than creating review noise.

## Maintenance guidance

The person may add natural-language instructions for each workspace, such as “prioritize
reimbursements,” “do not send routine completion summaries,” or “ask before moving meetings outside
work hours.” Guided setup should help turn stable parts into typed preferences or proposed rules
while retaining the original instruction, provenance, version, and effective scope.

Guidance applies to all setup, status, maintenance, and advisory surfaces. A channel-specific copy
must not drift into a separate SMS behavior, and prose guidance cannot bypass scopes, global review
policy, domain rules, or hard product limits.

Guided setup may generate a complete proposed rule set in one batch; proposal count is not an
activation shortcut. Every rule remains inactive until a dedicated preview makes its condition,
scope, source selection, representative matches and non-matches, intended action, consequences,
conflicts and precedence, required authority, and disable/rollback path inspectable. Large sets may
be grouped and paginated, but each rule stays individually reviewable and deselectable.

The preview binds to immutable proposal versions or fingerprints. If a rule or its evaluated source
sample changes, its preview becomes stale and must be regenerated before activation. Finishing
setup, trusting the agent, or enabling global review bypass does not activate an action rule; rule
activation follows the owning domain's explicit approval policy.

## External scheduling boundary

External platforms own maintenance schedules completely. nohmi exposes stable maintenance intents
and setup instructions, but it does not create, edit, pause, resume, or execute their recurring
schedules. A workspace may store the declared external host and expected cadence, show the last
observed invocation, and report expected, overdue, or unknown check-in health; those values are
observational and never trigger a run.

Internal queues, leases, retries, delayed authorized effects, and recovery timers may finish work
from an invocation nohmi already accepted. They do not constitute schedule ownership and cannot
originate a new recurring maintenance turn. To change when maintenance begins, the person must
change the schedule in its owning external platform.

The person may configure multiple external schedules or hosts for the same workspace and intent.
Each retains its own declared identity, cadence, check-in health, connection, and revocation state;
compatible invocations coalesce or resume through the domain's durable-run contract rather than
being rejected or allowed to duplicate effects.

## Shared notification policy and channel controls

One notification policy applies across SMS, in-app, push, email, and future channels. It decides
whether an underlying work item is eligible to notify, why it is eligible, its urgency, quiet-hour
handling, reminder interval, deduplication identity, material-change behavior, aggregation, and the
maximum content that may be disclosed. Global defaults may retain deliberate per-workspace
overrides, but the policy is evaluated once for the work item rather than independently by each
channel.

Each channel has separate delivery controls for whether it is enabled, its destination or device,
its supported interaction and links, and the format and detail appropriate to that medium. A
channel may mute or further reduce an eligible notification, but it cannot make a policy-suppressed
item eligible, bypass quiet hours or reminder suppression, widen action authority, or disclose more
than the shared privacy policy permits. Reviews remain the durable source of outstanding work even
when every delivery channel is disabled.

## Approved SMS controls

The person configures the following defaults globally. Each workspace inherits them until the
person deliberately creates a workspace override:

- inbound SMS routing into that workspace: enabled or disabled;
- maintenance SMS: questions and actions only by default, with explicit off or every-run options;
- whether replies may answer that workspace's questions;
- whether replies may approve exact reversible proposals when global review bypass is off;
- useful contextual identifiers with privacy-safe detail, or explicitly expanded message content;
- first-party review and recovery links when context, length, or multiple items require them; and
- the default 10:00 PM–8:00 AM quiet window, a custom window, or `any time` delivery; and
- a 7-day default reminder interval, a custom interval, or `never` for unresolved items.

These controls affect communication and routing only. The global review-bypass setting decides
whether an otherwise policy-authorized reversible action executes directly or enters review.
Enabling links does not enable passwordless access: every linked review uses normal nohmi
authentication.

The default is quiet on routine success. A maintenance run sends a proactive text only when nohmi
needs an answer, approval, recovery step, or other action from the person. This default does not
suppress a reply to a text the person initiated.

The default content includes the merchant, sender, event, task, or comparable entity name needed to
understand the action. Dates and times are rendered in the person's current time zone, using
`today`, `yesterday`, or `tomorrow` when applicable; unnecessary sensitive detail remains omitted.
Messages remain formal, short, and concise. They may include as many directly answerable items as
reasonably fit, with a hard cap of three. If two or three would make the message difficult to scan,
Texting includes fewer. Every multi-item message includes the unified cross-workspace Reviews link;
when more work remains, it adds a short overflow summary rather than sending separate messages per
item or workspace. Multi-item messages number each item and bind those references to the exact
message and proposal revisions; replies identify every answered number. This is the accepted
Texting target. Its unified cross-workspace destination is not implemented by the current scoped
Reviews flow, and emitted legacy links fall back to Account; see the
[Texting implementation gap](texting-operations.md#workspace-maintenance-notifications) and
[Reviews contract](../design/pages/reviews.md).

A self-contained single question omits the link unless the person needs more context or the
necessary content is too long for a reasonable text.

Quiet-hour deferral is enabled by default from 10:00 PM through 8:00 AM in the person's current time
zone. The person may change the window or select `any time`; deferred maintenance texts are
revalidated and consolidated when the window ends, while replies to user-initiated messages remain
immediate.

Each actionable item produces one initial notification record, which is the unit of deduplication
and reminder timing. Channel delivery may aggregate several item records into the single concise
message described above. An unchanged unresolved item may be mentioned again only after the
configured reminder interval; repeated maintenance runs do not restart or bypass that interval. The
default is 7 days, and `never` disables repeat notifications without removing the item from Reviews.
nohmi prefers missing a reminder over becoming repetitive.

Before that interval, the same item is eligible again only when the required action or the
consequence of acting or not acting materially changes. Wording, supporting evidence, confidence,
rediscovery, and internal status changes remain suppressed when they do not change either one;
quiet hours and send-time revalidation still apply.

## Inheritance boundary

Communication preferences use global defaults with explicit workspace overrides. This inheritance
applies only to settings for which an account-wide preference is useful; it does not mean that
every workspace setting has a global equivalent.

| Setting class | Examples | Behavior |
| --- | --- | --- |
| Global-only | Review bypass, cross-channel notification evaluation, Texting connection and consent, account security, connected-agent scopes, and hard privacy limits | One account value; a workspace or channel cannot override it |
| Global default with workspace override | Maintenance notification mode, quiet hours, reminder behavior, safe content ceiling, and aggregation | Inherit the account preference until the person deliberately changes that workspace; evaluation is shared across channels |
| Channel delivery | SMS, in-app, push, or email enablement, destination/device, supported interaction, link behavior, and medium-appropriate detail | Controls how an eligible notification is delivered; cannot create eligibility or widen privacy and action policy |
| Workspace-only | Connected sources, source meanings, definition of maintained, declared external host/cadence, maintenance guidance, domain rules, learned behavior, and connector recovery | Configure inside the owning workspace; schedule changes still occur in the external host |

For example, the person could keep the default “send only questions and actions, use privacy-safe
detail, and stay quiet overnight,” then let Mail inherit it while allowing Finances to send every
run and Calendar to send nothing. The override changes communication for that workspace; it does
not create a separate security policy or review-bypass value.

## Resolution order

Settings resolve in this order:

1. hard product and provider limits;
2. authenticated actor scopes and selected-source access;
3. global security, privacy, review-bypass, and shared notification policy;
4. workspace source, maintenance, privacy, notification-policy overrides, and channel delivery settings;
5. active domain rules and versioned maintenance guidance; and
6. purpose-bound User Knowledge used for interpretation and recommendations.

A lower layer cannot widen a higher layer. Missing or contradictory requirements produce a bounded
question or blocked result rather than an inferred permission.

## Current implementation boundary

Workspace presentation preferences are account-owned, with one owner-bound row per workspace.
The shared settings module exposes a workspace-discriminated contract: every read returns only that
workspace's fields, fully resolved defaults, and its revision. Untouched defaults have revision zero
and do not initialize storage. PATCH fields never supply read-time defaults; the response matches a
subsequent read. Writes require the workspace's write scope and an interactive person, reject stale
revisions, and record an audit event. The app serializes settings and contextual Display changes
through the same per-workspace save path. Each edit retains the revision observed by its UI; only
successful queued changes from that client advance it. A concurrent remote change produces a
conflict rather than silently rebasing captured values onto a newer revision. Explicit URL choices override saved defaults without
saving the link's choices back to the account.

| Workspace | Persisted preferences |
| --- | --- |
| Calendar | View, weekends, follow behavior, Sunday/Monday week start, default new-event duration (60 minutes initially; 5–1440 supported) |
| Tasks | Sort, grouping, row details, collection sorting, pins, default capture list, completed-item visibility in container views |
| Mail | Conversation layout, list density, desktop split width |
| Finances | Transaction view/card grouping and selected spending, cash, and investment accounts |
| All four | Include completed/archived material in search |

Finance account selections distinguish `null` (all eligible accounts, including newly added accounts)
from an explicit empty selection. They affect presentation only, never `includeInPlanning` or account
semantics. Existing browser-session selections are not silently adopted: the old keys contain no
owner identity. Missing or no-longer-eligible accounts are excluded when resolving a saved view.
Task capture defaults must reference an owned active list when saved; unavailable defaults fall back
to Inbox visibly. Explicit list/project destinations and existing tasks retain their destinations.
Saved completed visibility applies to container views, while explicit lifecycle views and URL
filters keep their own meaning.

Workspace settings consolidate editing, not data ownership. Mail inbox style, important-email
handling, and low-priority disposition/retention remain in the versioned domain profile. Calendar
source destination, buffers, and privacy remain in its versioned profile. Editing those controls
preserves other profile fields and does not activate action rules. Finance household/income facts,
financial profile revisions, budgets, and guidance retain their existing canonical stores; its
configuration endpoint assembles them with independent unavailable states.

The current notification policy supports global defaults and a Finance override. Finance Settings
shows the effective values and inheritance; a revision-guarded, audited reset removes the Finance
override without changing global preferences. Recreating an override cannot reuse a previous
revision. The global disclosure ceiling still applies. Other workspaces' notification overrides and
the complete shared maintenance/SMS sections above remain target behavior, not shipped controls.
Review bypass remains one revisioned global account policy and cannot grant scopes, activate rules,
override stronger approvals, or authorize unregistered domain operations.

### Desktop distribution

Settings → Desktop app is available in the browser for official installer
information. Installed desktop builds additionally show their installed version,
automatic update status, a manual check and confirmed restart action. The public
`/downloads` destination shares the same stable release metadata and distinguishes
unpublished releases, unavailable metadata and self-hosted configuration. It never
substitutes a guessed installer or stale success for a failed release read.

The accepted [Settings information architecture](../design/pages/settings-architecture.md) defines
configuration navigation, contextual setup, local history, and workspace-scoped Reviews placement.

### Save and recovery contracts

The three settings stores deliberately retain different semantics:

| Settings | Ownership and serialization | Revision and reset/default behavior |
| --- | --- | --- |
| Typed workspace preferences | Interactive owner; per-user/workspace transaction lock; mutation and audit commit together | Missing revision 0; every accepted partial save advances it. Product defaults and typed null sentinels belong to that workspace. Finance account selection null means all eligible accounts; an empty selection means none. |
| Notification policy | Interactive owner with existing Texting/Finance access; account row lock shared with notification operations; mutation and audit commit together | Missing revision null; first save starts at 1. Finance reset removes only its override, inheriting configured global values or product defaults, subject to the global disclosure ceiling. Reset audit records fence recreation so old revisions stay stale. |
| Account review policy | Interactive owner; account-wide transaction lock; changed policy and audit commit together | Missing policy is off/version 1. An unchanged exact-version save neither advances the version nor audits. Off remains an explicit account value; there is no workspace inheritance or delete reset. |

Compatible exact-revision comparisons and audit construction can share mechanics; storage,
authorization, locks, defaults, revision advancement and reset remain domain-owned. Notification
preference HTTP mutations retain their originating request ID in the audit record.

Settings recovery retains all unresolved field attempts in transient state shared by the current account, session and workspace. Newer failed values for the same field replace older failed values; an unrelated successful save cannot discard another field’s attempt. Matching confirmed saves and explicit acceptance clear only the corresponding intent. Each unresolved field retains its outcome; any uncertain field keeps the recovery explanation uncertain even when another attempt is rejected. A known revision conflict
explains rejection; an uncertain transport result explains that the change may already be saved.
Refreshing loads authoritative values without writing and keeps failed reads recoverable. The person
can explicitly accept the latest settings or reapply the displayed attempt against the exact version
just reviewed. Explicit replay never advances that revision through another queued write; a later write requires another review. Recovery controls wait for all queued writes in the workspace, including writes from another mounted control. Calendar and Mail expose this recovery at their contextual controls; Finance account selection shows readable account names and keeps a recovery entry after the dialog closes. Task pin failures link to their retained Settings recovery. Signing out or changing accounts clears transient attempts, including account review-policy and Finance notification-reset recovery; session generations fence late reads, mutation completions and callbacks, including switching away and back to the same account. A second conflict requires another review, never a silent retry with a newer version.
Workspace saves continue to bind intent to the observed revision; only that client's own successful
queued writes can advance it. Neither preference history nor a universal settings store is introduced.

The global notification editor remains a separate integration surface; these recovery controls cover
workspace preference settings, account review policy and the Finance notification reset.

The canonical Finance overview exposes Workspace view settings for saved spending, cash, and
investment account display selections, independently of financial snapshot availability. These
selections do not change the overview’s financial position totals, account meanings, or planning
inclusion. Retained failures can be reviewed after closing the selector or navigating to Finance
Settings; refreshing a recovery view does not save a change.
