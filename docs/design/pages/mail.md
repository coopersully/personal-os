# Mail

## Immediate job

Read and act on one unified mailbox while retaining clear source-account and provider authority.

Ilo never sends email. It has no compose, reply, forward, draft-creation, provider-delivery, or MCP
send capability. Historical Ilo draft records may only be listed by their owner, exported locally,
or permanently deleted by their owner.

## Connection health

- Mail uses the shared connected-account health contract; it does not interpret provider errors.
- A Mail-enabled account in `reconnect` produces one warning that names the affected account and
  links directly to Settings → Connections.
- Automatic retry and ilo-owned service attention keep the last synchronized material available.
  They do not claim the password is wrong and do not display raw provider responses.
- Connector health refreshes every 30 seconds while Mail is visible. Provider synchronization is
  owned by the server's five-minute scheduler, not browser polling.

## Persistent expert steward

Mail’s default objective is to keep known obligations explicit, current, and reviewable. An
approved user profile may replace that objective; otherwise Ilo does not invent goals from message
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
grant Ilo legal, security, relationship, retention, or transmission authority.

## Maintenance turn and status

One server-owned maintenance turn executes a fixed, checkpointed sequence: refresh sources,
capture a repeatable-read snapshot, assess it, reconcile the Ilo ledger, dispatch only already
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
| Automatic | Inspect; refresh/snapshot; reconcile Ilo-owned state; deduplicate questions; calculate status; publish reviews |
| Approved rule | Mark read/unread, star/unstar, archive, or move only through an active exact rule |
| Individual approval | Trash and rule activation |
| Unavailable | Compose, draft, reply, forward, and send email |

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

In v1, Ilo does not infer intent from prose and does not use model judgment for assessment. It asks
a bounded question when explicit evidence is absent. Ilo never sends email.

## Acceptance

- Mail uses the full workspace body: the conversation list and reader fill the
  available shell height like Calendar, rather than sitting in a capped card or
  narrow page column.
- Connected-account headers are disclosure categories, not mailbox selections:
  they stay visually flat while their indented child destinations carry the
  active state.
- Unified inbox is a disclosure category in the contextual sidebar. Its All
  mail, Unread, Starred, and Snoozed children govern the cross-account
  conversation list; account headers use the same category pattern.
- Mail keeps the global app bar for workspace identity and Sync. Search belongs
  to the conversation-list pane so its scope remains clear while a message is
  open.
- On desktop, the contextual Mail navigation and the conversation-list/reader
  boundary are independently resizable by pointer or keyboard. Both choices
  persist on the current device. The navigation rail stays within useful
  minimum and maximum widths; double-clicking its boundary restores the default.
- Conversation actions live at the top of the reader pane instead of spanning
  the entire workspace: Archive retains its label; Snooze, Star, and read state
  are icon controls; Delete stays in the More menu. The bar uses the shared
  neutral surface rather than a Mail-specific color.
- At narrow widths, Mail presents one focused surface at a time. Selecting a
  conversation opens the reader, Back to inbox restores the list, and compact
  actions move into More rather than overflowing horizontally.
- Unified and account mailbox navigation remains usable with stale synchronized material.
- A reconnect warning is scoped only to Mail-enabled accounts.
- Manual sync gives transient toast feedback and refreshes durable health after success or failure.
- No provider response body, token-shaped value, socket message, or exception reaches the Mail UI.
- The exact-thread stewardship panel exposes disposition, obligation state, question answers,
  explicit feedback, Calendar evidence handoff, and a private non-transmittable response brief.
- No Mail surface renders recipient/body composition, copy-to-send, `mailto:`, reply, forward, or
  send actions.
