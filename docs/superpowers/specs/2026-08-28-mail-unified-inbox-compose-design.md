# Mail unified inbox and compose design

**Date:** 2026-08-28  
**Status:** Approved in conversation  
**Workspace:** Mail

## Decision

Mail is a unified inbox first. Connected providers are sources of one inbox, not peer workspaces
that compete for attention. Individual account views remain available, but their hierarchy and
defaults gently keep the person in the combined inbox.

Ilo also regains the ability to compose and send user email. This decision supersedes the permanent
no-send product invariant in the 2026-08-15 Mail stewardship design and the 2026-08-25 no-send
capability-removal plan. The implementation must update every conflicting product, engineering,
provider, API, UI, infrastructure, and test contract in the same delivery slice. Transactional
product email remains a separate system.

The first send-capable release is text-only. It supports To and optional Cc. Bcc and attachments are
deferred because they introduce additional persistence, MIME, malware-scanning, privacy, and
provider-boundary requirements. No disabled or misleading attachment/Bcc controls appear.

## Current experience audit

The current Mail workspace reads like an application page containing a mailbox rather than a mail
client:

- The frame and workspace repeat the Mail title, consuming height without improving orientation.
- “Unified inbox” is an expandable mode with an “All mail” child, making the intended default feel
  equivalent to individual provider trees.
- Provider accounts are expanded and visually prominent, encouraging source-by-source navigation.
- “Stewardship review” and historical-draft recovery compete with the inbox for primary placement.
- The historical-draft strip consumes the entire workspace width even when it is not actionable.
- Sync is presented as a primary action even though synchronization should normally be ambient.
- Connection recovery is present but does not dominate enough when a required source is unhealthy.
- The resizable three-pane structure, list search, message previews, and reader-local controls are
  the strongest parts and should remain.

## Information architecture

### Sidebar

The sidebar begins with a selected `Inbox` destination representing all readable connected Mail
accounts. It is a destination, not a disclosure. Directly beneath it are unified views for Unread,
Starred, Snoozed, Sent, and Drafts. Counts are aggregated across accounts and do not imply that a
stale account contains zero items.

An `Accounts` disclosure follows the unified views and is collapsed by default. Each account row
shows its human label and a compact health indicator. Expanding an account reveals only useful
account-specific mailbox destinations. Selecting one adds an account scope to the current view;
returning to Inbox clears that scope.

Stewardship review, historical migration tools, and advanced Mail rules move to a secondary `More`
or settings area. Historical Ilo drafts appear inside Drafts as explicitly historical records, not
as page-wide furniture.

### Main workspace

The duplicate in-workspace Mail heading is removed. The message list owns search, current view
label, aggregate result count, selection controls, and subtle freshness state. Manual Sync moves to
an overflow action and remains available for recovery.

The list and reader remain horizontally resizable on desktop with persisted proportions. The first
visible conversation is selected on desktop when no valid selection exists, but selection alone
does not mark it read. Mobile remains list-first and navigates to a single reader pane with an
explicit back action.

The reader owns conversation actions. Reply and Forward open the shared composer with the relevant
account and thread context. Archive, snooze, read/unread, star, and trash remain reader-local.

## Connection and degraded states

The unified inbox continues showing cached projected mail when one account is stale or disconnected.
It never replaces cached content with an empty state or silently treats stale counts as zero.

A reconnect-required account creates a prominent banner above the message list containing the
account name, the impact (`New mail and sending are unavailable`), and one `Reconnect` action.
Multiple affected accounts consolidate into one banner with a `Review connections` action and
individual warning indicators under Accounts. Automatically retrying or stale sources use quieter
freshness language unless their age crosses the workspace stale threshold.

Read capability and send capability are separate. A source can remain readable while requiring new
authority before it can be selected in the composer. If no account can send, the compose button
remains visible but opens a recovery surface that explains the exact connection action rather than
presenting a dead editor.

## Floating compose interaction

Mail adopts the Calendar floating-surface interaction pattern, positioned at the bottom inline-end
of the Mail workspace rather than centered. In its closed state it is one circular plus button with
the accessible name `Compose a message`.

Opening it morphs the surface into a bottom-end composer. The surface traps no global navigation,
supports Escape, restores focus to the trigger, respects reduced motion, and stays within the
viewport and mobile safe areas. On narrow screens it expands to a near-full-width bottom sheet
without covering the app's mobile navigation.

The editor contains:

1. From, shown as a picker only when more than one healthy send-capable account exists;
2. To recipient entry;
3. an optional Cc field;
4. Subject;
5. a plain-text body;
6. an autosave state (`Saving…`, `Saved`, or an actionable error); and
7. Discard and Send actions.

From defaults to the only healthy account or the last healthy account used to send. It never
defaults to an unhealthy or read-only account. Reply and Forward preselect the source account and
thread; Forward produces editable quoted context while Reply addresses the relevant sender. Any
derived recipients remain visible and editable before confirmation.

Closing a non-empty composer keeps its durable draft. Discard requires confirmation when saved or
meaningful content exists. Empty untouched drafts may close without creating a record.

Choosing Send opens a second state in the same floating surface summarizing From, To, Cc, and
Subject. The exact button label is `Send message`. Confirmation is required for every message in
this slice; reusable sending rules and autonomous sending are out of scope.

## Domain and persistence contract

Every outbound message is a durable Ilo draft before delivery. Draft creation and update require
`mail:write`, ownership, a Mail-enabled account, and matching thread ownership when present. Drafts
store the selected account, optional thread, To, Cc, subject, body, and the existing durable send
state. Updates are accepted only while the draft is editable.

The composer saves after a short idle interval and on intentional close. The API supports create,
read, update, delete, send, and reconciliation. Sending accepts a draft ID rather than an arbitrary
message payload. The server locks and claims the saved draft, then verifies that its account,
thread, recipients, subject, and body still match the version confirmed by the person. A changed
draft returns a conflict and must be reviewed again.

The existing state machine is restored and tightened:

```text
draft -> sending -> sent
             \-> reconcile -> sent
                           \-> draft
```

Only `draft` is editable or safely retryable. `sending` has one durable claim and rejects concurrent
sends. A stale `sending` claim moves to `reconcile`; it never becomes retryable automatically.
`sent` is terminal. Reconciliation requires an explicit human outcome after checking provider Sent
Mail.

Successful sending writes a redacted audit event containing account, draft/thread references, and
recipient counts only. Recipient addresses, subject, and body are not audit or log fields.

## Provider boundary

### Google

Google Mail requests `gmail.modify` for projection/mutations and explicit `gmail.send` authority for
delivery. Existing accounts without the send grant remain readable and are marked reconnect-to-send.
Delivery uses the Gmail messages send endpoint with a bounded MIME payload and the shared provider
timeout. Reply/forward thread IDs are provider-owned values resolved from the local projection.

### iCloud

iCloud Mail restores authenticated SMTP submission to `smtp.mail.me.com:587` using the already
encrypted app-specific password. Connection, greeting, and socket timeouts remain below the API
edge budget. Production egress, infrastructure documentation, and network-contract validation are
restored in the same change. SMTP message submission is treated as ambiguous after the provider
request begins unless rejection is positively known before acceptance.

### Boundary record

| Concern | Contract |
| --- | --- |
| Capability owner | Mail owns draft/send semantics; connectors own provider protocol and acceptance classification. |
| Authority | Signed-in human with `mail:write`, owned account, provider send grant/credential, and per-message confirmation. |
| Transport | Google HTTPS/TCP 443; iCloud authenticated SMTP submission/TCP 587 with STARTTLS. |
| Time | Provider attempts use bounded connector timeouts below the 60-second edge limit; there is no automatic send retry. |
| Commit point | The durable draft send claim commits before provider submission. Provider acceptance and local completion are separate facts. |
| Delivery semantics | At-most-one automatic attempt per claim. Ambiguous outcomes require Sent Mail inspection and explicit reconciliation. |
| Degraded behavior | Draft remains visible with retry-safe, sending, sent, or delivery-uncertain language and the exact recovery action. |
| Observation | Redacted structured connector signals, durable draft state, safe account health, and audit metadata without message content. |
| Evidence | Contract/unit tests, database integration tests, connector simulator tests, runtime network validation, browser acceptance, and a post-deploy provider smoke owned by release operations. |

Green mocks cannot prove production provider authority, OAuth verification status, SMTP egress, or
provider acceptance. Those remain explicit release gates and evidence items.

## Failure behavior

- Validation or provider rejection known before acceptance leaves the draft in `draft` and explains
  what to correct. It is safe to retry after correction.
- Reconnect-required failures preserve the draft, remove the account from send choices, and link to
  connection recovery.
- A transport failure, timeout, process loss, or local persistence failure after provider submission
  moves the draft to `reconcile` whenever Ilo cannot prove non-acceptance.
- `reconcile` is represented as `Delivery uncertain`, never `Failed`. The actions are `Open Sent
  Mail`, `Mark as sent`, and `Not sent — allow retry`.
- A recent `sending` claim displays progress and cannot be resent. A stale claim becomes uncertain.
- Autosave failure keeps editor content in memory, clearly says it is not saved, and disables Send
  until the exact content is durably stored.
- Closing or navigating away while unsaved content exists triggers a warning; saved drafts require
  no navigation warning.

## API and ownership

Mail continues owning its domain contracts, routes, service, web feature, and tests. Integration
owns shared connector types, provider implementations, OAuth capability projection, network policy,
app-frame interaction, and shared icon/floating-surface primitives. Provider message content remains
private Mail data and never enters assistant prompts, analytics, or external logs through this
feature.

The old `410 feature_unavailable` send compatibility endpoints are replaced by authenticated,
typed Mail routes. Typed API clients regain only the human product operations needed by the web
workspace. MCP sending and autonomous Mail sending remain unavailable in this slice.

## Testing and acceptance

Focused domain and API tests must prove:

- only an owned, editable, exactly confirmed draft can be sent;
- concurrent, duplicate, stale, and replayed requests cannot cause an automatic second attempt;
- pre-acceptance rejection is retryable while ambiguous acceptance is not;
- reconciliation is owner-scoped, human-only, and audit-backed;
- message content and addresses are absent from logs, errors, and audit metadata;
- read-only and reconnect-required accounts are excluded from send choices without disappearing
  from the unified inbox; and
- Google scope projection and iCloud network/timeout contracts match runtime policy.

Web tests and browser acceptance must prove:

- Inbox is the default and account navigation is visually secondary;
- all unified views preserve account aggregation and URL state;
- the connection banner is prominent and cached mail remains usable;
- pane resizing persists and mobile uses one pane;
- the floating plus opens, closes, restores focus, respects Escape/reduced motion, and fits mobile;
- autosave, discard, confirmation, success, reconnect, validation, and delivery-uncertain states are
  complete and keyboard accessible;
- Reply and Forward use the source account and retain visible, editable recipients; and
- no attachment, Bcc, or autonomous-send affordance is implied.

Repository verification remains `pnpm verify`. Production release additionally requires Google
OAuth/send authority evidence, iCloud SMTP egress evidence, and one least-privileged controlled send
per supported provider with cleanup and redacted observation.

## Documentation supersession

Implementation must update `docs/design/pages/mail.md`, `docs/design/system.md`, product capability
language, connector reliability, deployment/network documentation, and the Mail stewardship design.
The prior no-send plan remains historical evidence of the earlier decision but must be marked
superseded rather than silently edited into a different plan.
