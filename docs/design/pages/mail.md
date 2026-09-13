# Mail

## Immediate job

Read and act on one unified mailbox while retaining clear source-account and provider authority.

The combined Inbox is the default and visually primary destination. Individual provider accounts
remain available as an app-bar visibility filter for troubleshooting and deliberate single-source
review, not as sidebar destinations or the normal way to use Mail.

Signed-in people may compose, reply, forward, and send plain-text messages. Every message is an
nohmi-owned durable draft, autosaved before an explicit final confirmation. MCP and autonomous
stewardship have no send capability.

The current draft and provider-delivery contracts do not preserve rich text or outbound
attachments. Mail does not expose formatting or attachment controls until those capabilities are
durable from draft creation through provider acceptance.

## Connection health

- Mail uses the shared connected-account health contract; it does not interpret provider errors.
- A Mail-enabled account in `reconnect` produces one warning that names the affected account and
  links directly to Settings → Connections.
- Automatic retry and nohmi-owned service attention keep the last synchronized material available.
  They do not claim the password is wrong and do not display raw provider responses.
- Connector health refreshes every 30 seconds while Mail is visible. Provider synchronization is
  owned by the server's five-minute scheduler, not browser polling.

## Persistent expert steward

Mail’s default objective is to keep known obligations explicit, current, and reviewable. An
approved user profile may replace that objective; otherwise nohmi does not invent goals from message
prose. The durable ledger contains owner-scoped obligations, versioned thread dispositions,
deduplicated questions, explicit rule proposals, review feedback, and immutable reviews. Provider
messages remain source material rather than becoming another mutable ledger.

The `mail-playbook-v1` release combines six bounded professional perspectives:

- chief of staff for explicit goals, commitments, dependencies, deadlines, and opportunity cost;
- correspondence triager for materiality, routing, ownership, urgency, and follow-up candidates;
- executive assistant for candidate dates, commitments, and waiting-for relationships;
- records clerk for provenance, retrieval, attachments, and approved retention meaning;
- security reviewer for observed suspicious signals and unsafe requests; and
- communications adviser for a private response checklist that is always `transmittable: false`.

Its research registry records review dates and renewal intervals for UK correspondence guidance,
NARA electronic-message records guidance, NIST email-security guidance, CISA phishing guidance,
and Gmail label semantics. Those sources bound the rubric; they do not override the user’s goals or
grant nohmi legal, security, relationship, retention, or transmission authority.

## Maintenance turn and status

One server-owned maintenance turn executes a fixed, checkpointed sequence: refresh sources,
capture a repeatable-read snapshot, assess it, reconcile the nohmi ledger, dispatch only already
approved exact rule work, publish an immutable review, and verify the result. Durable leases,
idempotent step records, retry timing, and honest failure states allow recovery without replaying a
completed snapshot. The in-app server scheduler may resume work; there is no external client
automation.

The API owns the four display states:

- **Clean:** current evidence, a current review fingerprint, and no material question or unsettled
  provider effect.
- **Needs work:** known obligations/effects remain or a current review must be published.
- **Needs your input:** material ambiguity is preserved as an open bounded question.
- **Blocked:** stale, partial, unavailable, failed, or indeterminate evidence prevents settlement.

`/mail/review` renders that state verbatim with freshness cutoff, objective/profile version,
ledger counts, health dimensions, questions, effects, active maintenance, and the latest immutable
review. “Maintain Mail” makes one request and invalidates first-party queries; the browser does not
poll, sequence steps, retry effects, or decide completion.

## Authority and learning

| Boundary | Authority |
| --- | --- |
| Automatic | Inspect; refresh/snapshot; reconcile nohmi-owned state; deduplicate questions; calculate status; publish reviews |
| Approved rule | Mark read/unread, star/unstar, archive, or move only through an active exact rule |
| Individual approval | Trash and rule activation |
| Signed-in person | Compose, edit drafts, reply, forward, explicitly confirm send, and reconcile uncertain delivery |
| Unavailable | Autonomous or MCP-originated email transmission |

One-off question answers resolve only the exact record. Reusable learning requires an explicit
generalization proposal with examples, counterexamples, and exceptions, followed by separate rule
approval. Correct, incorrect, outdated, and exception feedback remains durable evidence; it never
silently widens authority. Revision conflicts refresh the owning read model before retry.

## Review artifact and integration boundaries

Every published review records its evidence cutoff, ledger fingerprint, playbook/rulebook/profile
versions, source freshness, obligation/question/effect counts, multidimensional health, settlement
state, and next maintenance time. Reviews retain IDs, revisions, counts, and bounded source
references—not credentials, raw provider payloads, complete message bodies, addresses, or private
chain-of-thought. Changed evidence produces a successor; a published review is never edited.

Mail owns all judgments and mutations in its domain/API. Shared Integration changes are limited to
owner-fenced connector work dispatch, application composition and routing, deterministic QA data,
and privacy-minimized projection of open Mail questions or a represented blocked run into Today’s
Reviews destination. Reviews links back to Mail and never duplicates a mutation.

MCP exposes only `get_mail_status` and `maintain_mail` for complete-workspace stewardship. It is a
stateless intent surface: it validates input, makes one authenticated API call, and returns the API
result. It owns no playbook, memory, batching, confidence threshold, sequencing, retry, polling,
approval, learning, status inference, or completion decision. Existing surgical read/update and
approved-rule preview tools remain typed API adapters.

In v1, nohmi does not infer intent from prose and does not use model judgment for assessment. It asks
a bounded question when explicit evidence is absent. Only the signed-in human Mail surface can
initiate delivery.

## Acceptance

- Mail uses the full workspace body: the conversation list and reader fill the
  available shell height like Calendar, rather than sitting in a capped card or
  narrow page column.
- Inbox, Unread, Starred, Snoozed, Sent, and Drafts are direct unified destinations.
- The sidebar contains destinations only. A compact app-bar avatar control filters the unified view
  by source account, defaults to every account, preserves at least one visible account, and exposes
  account health plus a direct Settings repair path.
- Mail keeps workspace identity, search, and Sync together at the start of the primary app bar.
  Search remains available while reading and changing it returns to the conversation list. The
  account filter occupies the far edge of the same bar.
- On desktop, the Mail sidebar and the conversation-list/reader boundary are independently
  resizable by pointer or keyboard. Both choices persist on the current device. The navigation rail
  also collapses into a standard icon-only rail with accessible tooltips; double-clicking its
  boundary restores the default width.
- Conversation count, list density, and reader actions share one full-workspace
  `WorkspaceSecondaryAppBar`: Archive retains its label; Snooze, Star, and read state are icon
  controls; Delete stays in the More menu. List density is a stable icon action with a standard
  radio menu rather than a labelled control that competes with message actions. The bar uses the
  shared neutral surface rather than a Mail-specific color.
- The conversation list defaults to Comfortable and offers Compact and Expanded device-local
  layouts. Comfortable and Expanded show a sender avatar before the sender name; Compact minimizes
  vertical detail without removing the sender, subject, or received time.
- At narrow widths, Mail presents one focused surface at a time. Selecting a
  conversation opens the reader, Back to inbox restores the list, and compact
  actions move into More rather than overflowing horizontally.
- Unified navigation and account visibility filters remain usable with stale synchronized material.
- A reconnect warning is scoped only to Mail-enabled accounts.
- The reconnect warning is visible on the account control and beside its affected account so cached
  mail stays visible and useful.
- The end-justified floating plus opens a top-level modal composer with From, To, optional Cc,
  Subject, and Message. Only accounts with current send capability appear as senders; when none are
  eligible, the composer shows a direct Connections recovery action instead of an unusable field.
  Drafts autosave and expose an explicit Save draft action, Escape restores focus, and the final
  send confirmation names the sender and recipients.
- Reply and Forward live with the reader controls. Drafts exposes editable drafts and explicit
  reconciliation for delivery whose provider acceptance is uncertain.
- Each message header toggles that message between its expanded and collapsed state. Sender and
  recipient names expose their available identity details on hover or keyboard focus; the reader
  does not duplicate From, To, or Date metadata in a separate disclosure.
- Manual sync gives transient toast feedback and refreshes durable health after success or failure.
- No provider response body, token-shaped value, socket message, or exception reaches the Mail UI.
- The exact-thread stewardship panel exposes disposition, obligation state, question answers,
  explicit feedback, Calendar evidence handoff, and a private non-transmittable response brief.
- No MCP or autonomous Mail surface renders a send action or obtains provider delivery authority.
