# ADR 0006: General texting inbox and workspace dispatch

- Status: Accepted target architecture; implementation pending
- Date: 2026-09-10

## Context

nohmi already has a hardened one-to-one SMS transport, but current reads and sends are generic
manual tools. The target product needs every workspace maintenance flow to send concise results and
questions, and it needs the person to use the same conversation for free-form requests spanning
Mail, Tasks, Calendar, Finances, and shared services.

Putting SMS processing inside each workspace would create competing consumers, duplicate transport
logic, make cross-workspace messages ambiguous, and fragment one human conversation. Treating
Texting as a fifth workspace would incorrectly give it ownership of domain records and expertise.

## Decision

Texting is a shared channel with a domain-owned coordinator, not a core workspace. It owns:

- consent, connection, conversation, delivery, and uncertain-send reconciliation;
- durable inbound claims and event-driven processing;
- classification into existing-work-node answers, reviews, or new intents;
- routing and linked child-intent coordination across workspaces;
- application of global and per-workspace channel settings; and
- concise response composition over domain-owned results.

Each workspace owns the operation, evidence, policy decision, work nodes, and terminal truth for
its child intent. Texting cannot call providers on a workspace's behalf, embed workspace playbooks,
reinterpret a domain result, or grant action authority.

`maintain_texting` is the recovery and catch-up intent for unprocessed messages, interrupted child
work, unresolved delivery, and missing replies. Inbound webhook arrival should durably enqueue the
same coordinator promptly; the maintenance intent and event-driven path share one source of truth.

Workspace stewards publish typed notification intents rather than rendered SMS. They provide the
minimum useful entity context and canonical times; Texting applies channel policy, converts times
to the person's current time zone, renders nearby dates relatively, and composes one result, one
available question or exact review action, and an optional first-party deep link.

When several questions or actions are available, Texting renders only a brief formal statement
with the unified Reviews link. It sends one notification across workspaces rather than
serializing the queue into SMS or sending one message per item or domain.

Unified Reviews includes questions, approvals, connector failures, recovery steps, and other work
that requires the person. Informational and automatically recoverable states remain in their owning
workspace status and activity history rather than producing a review item or proactive SMS.

A self-contained single question has no link. Texting adds an exact-item or domain link only when
that question needs context or cannot remain a reasonable SMS; multiple items use unified Reviews.

Review links use ordinary authenticated nohmi routes. The URL identifies a requested destination but
contains no bearer credential, action authority, answer, or sensitive item content; SMS recipient
verification does not create a web session. Authentication preserves and resumes the requested
destination.

## Authority

One global review-bypass policy applies across app, API, MCP, scheduled, and SMS callers. With
bypass enabled, policy-authorized reversible actions may execute directly. With bypass disabled,
they become exact reviews; a verified SMS answer may approve an unexpired, revision-bound,
reversible proposal.

Bypass does not widen scopes or permit blocked, unsupported, irreversible, scope-changing,
recipient-changing, credential, or ambiguous effects. Every routed intent preserves the SMS actor,
conversation message, child run, source evidence, policy, approval, effect, and recovery chain.

## Reliability

- Each inbound message has one durable claim and an idempotent routing identity.
- Child intents have stable identities and can resume without replaying completed effects.
- A cross-workspace reply waits for honest child states and never reports partial work as complete.
- Ambiguous routing asks one clarification and leaves unrelated work available.
- An uncertain outbound provider result reconciles before identical content can be sent again.
- A queued message that crosses the person's local date boundary is rendered again before provider
  submission so relative dates remain accurate.
- Proactive maintenance delivery respects the default 10:00 PM–8:00 AM local quiet window, a custom
  window, or explicit `any time` mode. Deferred items are revalidated before release; resolved or
  expired work is not sent, and multiple remaining items become one unified Reviews notification.
- Notification history is keyed to durable work-item identity. Rediscovery by later maintenance
  runs cannot resend an unchanged item before the configured reminder interval elapses. The default
  is 7 days; `never` suppresses repeats without changing the work item's review state.
- STOP, disconnect, feature disablement, or workspace SMS disablement stops new sends and routing
  while preserving prior audit and recovery state.

## Consequences

- The person gets one continuous general nohmi inbox without creating a fifth workspace.
- Workspaces can use SMS without depending on Twilio or reading the shared conversation.
- General requests can span domains while retaining domain ownership and least privilege.
- The current transport can be retained, but durable routing, child intents, notification intents,
  global review bypass, per-workspace controls, and SMS approvals require new target work.
