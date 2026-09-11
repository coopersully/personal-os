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
| Global account | Review bypass, notification and Texting defaults, connected agents, security, and privacy defaults | Domain meanings or workspace-specific instructions |
| Workspace | Sources, source meanings, maintenance behavior, explicit communication overrides, workspace privacy, and active guidance | Global identity, agent scopes, or hard safety limits |
| Rule | One explicit reusable condition, action, sources, exceptions, and policy | General personal context or broad prose instructions |
| User Knowledge | Goals, priorities, relationships, preferences, constraints, habits, and learned patterns | Action authority or external mutation rules |

## Shared workspace sections

Every Mail, Tasks, Calendar, and Finances settings surface should use the same conceptual sections
while presenting domain-specific controls:

- **Sources and synchronization:** connected providers, selected sources, meanings, destinations,
  capabilities, freshness, failures, retries, and removal.
- **Maintain:** whether maintenance is enabled, its bounded scope and review cadence, the current
  definition of maintained, and custom maintenance guidance.
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

## Maintenance guidance

The person may add natural-language instructions for each workspace, such as “prioritize
reimbursements,” “do not send routine completion summaries,” or “ask before moving meetings outside
work hours.” Guided setup should help turn stable parts into typed preferences or proposed rules
while retaining the original instruction, provenance, version, and effective scope.

Guidance applies to all setup, status, maintenance, and advisory surfaces. A channel-specific copy
must not drift into a separate SMS behavior, and prose guidance cannot bypass scopes, global review
policy, domain rules, or hard product limits.

## Approved SMS controls

The person configures the following defaults globally. Each workspace inherits them until the
person deliberately creates a workspace override:

- inbound SMS routing into that workspace: enabled or disabled;
- maintenance SMS: questions and actions only by default, with explicit off or every-run options;
- whether replies may answer that workspace's questions;
- whether replies may approve exact reversible proposals when global review bypass is off;
- useful contextual identifiers with privacy-safe detail, or explicitly expanded message content;
- first-party review and recovery links when context, length, or multiple items require them; and
- the default 10:00 PM–8:00 AM quiet window, a custom window, or `any time` delivery.

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

## Inheritance boundary

Communication preferences use global defaults with explicit workspace overrides. This inheritance
applies only to settings for which an account-wide preference is useful; it does not mean that
every workspace setting has a global equivalent.

| Setting class | Examples | Behavior |
| --- | --- | --- |
| Global-only | Review bypass, Texting connection and consent, account security, connected-agent scopes, and hard privacy limits | One account value; a workspace cannot override it |
| Global default with workspace override | Maintenance notification mode, quiet hours, inbound SMS routing, reply handling, safe content detail, and first-party links | Inherit the account preference until the person deliberately changes that workspace |
| Workspace-only | Connected sources, source meanings, definition of maintained, maintenance guidance, domain rules, learned behavior, and connector recovery | Configure inside the owning workspace; no global value is implied |

For example, the person could keep the default “send only questions and actions, use privacy-safe
detail, and stay quiet overnight,” then let Mail inherit it while allowing Finances to send every
run and Calendar to send nothing. The override changes communication for that workspace; it does
not create a separate security policy or review-bypass value.

## Resolution order

Settings resolve in this order:

1. hard product and provider limits;
2. authenticated actor scopes and selected-source access;
3. global security, privacy, review-bypass, and notification policy;
4. workspace source, maintenance, privacy, and channel settings;
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

- Whether notification overrides eventually apply independently to every channel or only to SMS
  initially.
- Whether maintenance cadence is configured in nohmi, delegated entirely to external schedulers,
  or represented only as an expected-check-in contract.
- How much rule generation guided setup may propose before requiring a dedicated preview.
- Which settings belong inline inside each workspace and which also appear in centralized Settings.
