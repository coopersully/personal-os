# nohmi per-workspace settings

- Status: Living target product contract; decisions are being refined
- Last reconciled: 2026-09-10

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
in the unified Settings-owned Reviews queue. Informational and automatically recoverable states stay
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
Messages remain formal, short, and concise. One item may be asked directly; several items produce a
single statement that several items need review plus the unified cross-workspace Reviews link,
rather than a long SMS checklist or separate messages per workspace.

A self-contained single question omits the link unless the person needs more context or the
necessary content is too long for a reasonable text.

Quiet-hour deferral is enabled by default from 10:00 PM through 8:00 AM in the person's current time
zone. The person may change the window or select `any time`; deferred maintenance texts are
revalidated and consolidated when the window ends, while replies to user-initiated messages remain
immediate.

Each actionable item produces one initial notification. An unchanged unresolved item may be
mentioned again only after the configured reminder interval; repeated maintenance runs do not
restart or bypass that interval. The default is 7 days, and `never` disables repeat notifications
without removing the item from Reviews. nohmi prefers missing a reminder over becoming repetitive.
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

Current settings are distributed across account settings, connections, workspace access, domain
profiles, Finance settings, Texting, and feature-specific pages. Finances has a workspace-specific
review-bypass control, while the approved target is one global review-bypass policy. The complete
shared per-workspace structure, maintenance guidance model, and SMS controls above are target
behavior and must not be presented as shipped.

## Open design questions

- Which settings belong inline inside each workspace and which also appear in centralized Settings.
