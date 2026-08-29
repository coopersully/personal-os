# Agent texting design

- Status: Approved in chat; awaiting written-spec review
- Date: 2026-08-28

## Purpose

Give each ilo account a private SMS conversation that authorized agents can read
and answer through MCP. The human uses their own verified mobile phone. ilo uses
one permanent, shared Twilio toll-free number for every account. The first
release is asynchronous: agents poll durable history and send explicit replies;
ilo does not wake or host an agent when a text arrives.

The feature is named **Texting** in product copy and code so it does not collide
with the existing email-oriented Mail domain.

## Product decisions

- One verified US or Canadian mobile number may be active on an ilo account.
- An active mobile number may belong to only one ilo account at a time.
- All users text the same verified Twilio toll-free number.
- An inbound sender is routed to an account by the active verified phone-number
  fingerprint. There is no user-entered routing code.
- Every agent authorized for an account shares the same immutable conversation
  history and ilo sender identity.
- Before every outbound message, the sending agent must read a fresh,
  unfiltered view of the latest conversation. A send cannot race past a newer
  inbound or outbound message.
- An ordinary agent response is exactly one outbound SMS message/bubble. A
  multi-bubble series is reserved for structured data or user-requested large
  content that cannot remain usable in one message.
- Agents may send only to the account's active verified number. There is no
  recipient argument or arbitrary-number API.
- Version 1 supports plain SMS text only. It excludes MMS, attachments, group
  messaging, alternate channels, scheduled sends, and real-time agent wakeups.
- Agents may initiate a message after the user has explicitly opted in.
- Conversation content remains with the account until the user explicitly
  deletes it or deletes the account. Changing or disconnecting a phone preserves
  history.
- Version 1 supports US and Canada only and uses one verified toll-free sender.

## Non-goals

This design does not provide a web chat client, contacts/address book, arbitrary
recipient messaging, a number per user, agent assignment or claiming, unread
state, message reactions, voice calls, MMS, marketing campaigns, or a general
notification system. It does not use the user's personal number as a sender.
It does not make Twilio the durable source of conversation history.

## Architecture

Texting is a vertical ilo feature that follows ADR 0001:

- `packages/domain/src/texting.ts` owns schemas, states, invariants, pagination,
  and public types.
- `packages/connectors/src/twilio.ts` owns Twilio Verify, Programmable Messaging,
  segment estimation, provider error normalization, and Twilio request
  validation. No web, API route, MCP tool, or database repository calls Twilio
  directly.
- `packages/database` owns the Drizzle schema, atomic migration, and repositories.
- `apps/api/src/texting-service.ts` owns setup, routing, consent, quotas,
  idempotency, persistence, policy, and audit behavior.
- `apps/api/src/routes/texting.ts` owns authenticated human and agent HTTP routes.
- A focused API webhook module owns unauthenticated Twilio ingress and delegates
  signature validation and normalization to the connector before invoking the
  service.
- `packages/api-client/src/features/texting.ts` exposes the same typed API to the
  web and MCP surfaces.
- `apps/web/src/features/texting` owns the Settings experience.
- `apps/mcp/src/tools/texting.ts` remains a stateless API adapter.

The Integration owner must wire the new feature into `apps/api/src/app.ts`,
`apps/mcp/src/server.ts`, `apps/web/src/app.tsx`, the API-client composition root,
the database schema and migration journal, navigation, and feature registries.
`docs/engineering/feature-ownership.md` must gain a Texting owner row before
parallel implementation begins.

### Inbound data flow

1. Twilio receives an SMS at ilo's toll-free number.
2. Twilio posts the form-encoded message to the configured ilo webhook.
3. ilo validates `X-Twilio-Signature` against the configured public URL and the
   complete form parameter set using Twilio's supported SDK.
4. The connector verifies the configured Twilio account, Messaging Service, and
   destination sender and normalizes the event.
5. The service deduplicates the provider `MessageSid`.
6. The service fingerprints the normalized `From` number and resolves exactly
   one active, verified connection.
7. A normal message is stored as an inbound conversation message. A compliance
   keyword event is stored as a consent event and excluded from conversation
   results.
8. ilo returns empty TwiML promptly. A valid duplicate also returns success
   without repeating any effect.

An unknown, inactive, or unverified sender receives no ilo-authored reply and
creates no user-visible message. ilo records only a masked operational event.
Twilio and carriers continue to handle their required keyword response.

### Outbound data flow

1. An authenticated agent calls `read_text_conversation` and receives the
   latest conversation context, explicit current time, and a short-lived opaque
   conversation receipt bound to that access token and exact conversation
   revision.
2. The agent considers the participants, chronology, current local date/time,
   and relevant earlier history before composing a reply.
3. The agent calls the public API through MCP with `texting:write`, the message
   body, and that conversation receipt.
4. The service resolves the account's active connection and atomically checks
   the receipt, current conversation revision, consent, provider readiness,
   per-account rate limits, the global circuit breaker, and the request
   idempotency key.
5. The API applies any required ilo identity and opt-out envelope, validates the
   final provider body, estimates and reserves its SMS segments, increments the
   conversation revision, and inserts an audited pending message
   transactionally.
6. The Twilio connector creates the Message through the configured Messaging
   Service. There is no caller-controlled `From` or `To`.
7. The returned Twilio `MessageSid` and initial status are attached to the
   durable message.
8. Signed Twilio status callbacks advance the message through the supported
   delivery state machine.

The public API, rather than MCP, remains the authorization and policy boundary.

## Phone setup and identity

Phone administration requires an interactive human session. Agents cannot add,
verify, replace, disconnect, or reveal a phone number.

1. The user enters a US or Canadian number and separately accepts explicit SMS
   consent copy that identifies ilo, explains the conversational purpose and
   expected frequency, notes that message/data rates may apply, and explains
   STOP and HELP.
2. ilo normalizes the number to E.164 and asks Twilio Verify to send an SMS OTP.
3. ilo stores a short-lived pending challenge but never stores the OTP.
4. The user submits the OTP. Only Twilio Verify's `approved` result can activate
   the number.
5. Activation transactionally enforces that no other active ilo connection has
   the same keyed phone fingerprint and starts a new consent epoch.

Verification proves possession; it does not by itself constitute messaging
consent. Both successful verification and the explicit consent record are
required. Failed and expired challenges are rate-limited and do not disturb an
already active number. A number change verifies the replacement before an
atomic swap, so a typo cannot disconnect the current number.

The normalized number is encrypted with ilo's application encryption key. A
separate deterministic HMAC fingerprint, made with a purpose-specific secret,
supports inbound lookup and active uniqueness without exposing the number.
Clients receive only country and masked last-four display data. Full numbers,
message bodies, and credentials never appear in logs or audit snapshots.

## Consent and Twilio suppression

Effective permission to send is the conjunction of:

- an active Twilio-approved phone verification;
- a current ilo consent epoch;
- no newer authenticated Twilio or carrier opt-out signal;
- no administrative suspension;
- a healthy enough provider state to know that sending is allowed.

Twilio's suppression enforcement is authoritative. ilo maintains a fail-closed
local mirror so agents receive a useful error before a prohibited provider
call. The toll-free sender uses Twilio's standard carrier keyword behavior; ilo
does not enable Advanced Opt-Out because Twilio discourages it for toll-free
numbers.

ilo subscribes to the versioned
`com.twilio.messaging.inbound-message.received` Event Streams event containing
typed `STOP`, `START`, and `HELP` signals. Event Streams events are signed,
authenticated, deduplicated, and processed by provider time because delivery is
at least once and may be out of order.

- `STOP` and equivalent provider-classified opt-out keywords immediately move
  the local connection to `opted_out`.
- A Twilio send rejection with error `21610` also immediately moves the
  connection to `opted_out`, covering a delayed or missed event.
- `HELP` records a compliance event but does not alter consent.
- After an opt-out, only a later authenticated, provider-classified `START`
  event from that active handset starts a new active consent epoch.
- Settings never offers an independent re-enable toggle. It instructs the user
  to text START to the ilo number.
- ilo does not send its own STOP, START, or HELP reply because Twilio/carriers
  already send the required response.
- Compliance keyword bodies are not returned in agent conversation history.

If event order is equal or ambiguous, STOP wins. A normal inbound message after
STOP may still be stored and read, but it does not restore consent and agents
cannot answer until START succeeds.

Twilio's Consent Management API is not required for version 1 because the
handset-originated START path clears the provider block. If ilo later adds an
in-app re-opt-in path, that is a separate design: it must provide new express
consent and clear both the Messaging Service-level and individual sender-level
Twilio records before local activation.

## Persistence model

The migration creates `texting_connections`,
`texting_verification_challenges`, `text_messages`,
`texting_consent_events`, and `texting_provider_events` with the following
independent responsibilities:

### Texting connections

`texting_connections` has one current row per user. It holds the encrypted
active number, keyed fingerprint, masked display data, country, verification
timestamps, monotonically increasing consent epoch, provider synchronization
state, monotonically increasing conversation revision, administrative
suspension, and lifecycle timestamps. Its effective state is one of `active`,
`opted_out`, `sync_error`, `suspended`, or `disconnected`. A partial unique
constraint permits only one non-disconnected connection per fingerprint.
Disconnecting ends the routing association without deleting conversation
history. Every newly stored inbound or outbound conversation message advances
the revision atomically; conversation deletion also advances it. Number changes,
disconnects, and START create or end an epoch and therefore invalidate every
older receipt. Compliance-only provider events do not advance the conversation
revision, although a STOP transition independently blocks sending.

### Verification challenges

Short-lived, user-bound `texting_verification_challenges` records hold the
normalized-number fingerprint, encrypted candidate number, Twilio verification
identifier, expiry, attempt metadata, and `pending`, `approved`, `expired`,
`failed`, or `cancelled` state. A new challenge supersedes an older unused
challenge for the same user. No verification code is stored.

### Text messages

Each `text_messages` row stores:

- ilo ID and owning user ID;
- connection/consent epoch reference;
- inbound or outbound direction;
- the final text body exactly as submitted to Twilio, including any API-owned
  compliance envelope;
- encrypted immutable phone snapshot and masked display snapshot;
- provider `MessageSid` when known, uniquely indexed;
- accepted, queued, sending, sent, delivered, undelivered, failed, or unknown
  status;
- canonical `occurredAt`, its provider-or-ilo timestamp source, and outbound
  `sentAt` and `deliveredAt` lifecycle timestamps when known;
- Twilio-safe error code, predicted and actual segment counts, and other
  provider timestamps;
- outbound actor type and access-token ID;
- agent content kind and optional server-issued series ID, part, and total;
- API idempotency subject/key and request correlation ID;
- created and updated timestamps.

Message bodies use the database's normal protected storage and backup controls.
The phone number additionally uses field encryption because it is an account
routing identifier.

### Consent events

Append-only `texting_consent_events` records contain the connection and consent epoch, transition,
source (`website`, `twilio_event`, `twilio_send_rejection`, `disconnect`, or
`administrative`), provider event reference, actor, effective time, received
time, and redacted request/audit identifiers. They never contain a body or full
phone number.

### Provider event receipts

Short-retention `texting_provider_events` receipts contain Twilio event/message IDs, type, schema version,
provider timestamp, processing result, and a non-sensitive payload fingerprint.
They prevent duplicate webhook effects and make out-of-order reconciliation
observable. Raw webhook payloads are not retained. Account deletion cascades
receipts that can be associated with the account; global unmatched receipts
expire automatically.

Conversation deletion removes bodies, message phone snapshots, and message
provider metadata. It records a redacted audit event and a deletion cutoff so a
late status callback cannot recreate deleted history. Account deletion cascades
all texting state. Disconnect and number change preserve history by default.

## HTTP and MCP contracts

The domain adds `texting:read` and `texting:write` to `AccessScope`, the Texting
feature manifest, OAuth scope handling, token presets, authorization docs, and
feature access policy. Texting write is an `approved_rule`: the explicit token
grant plus the user's active SMS consent authorizes only the bounded active
number. A token cannot receive `texting:write` without `texting:read`, because a
fresh read receipt is mandatory for every send.

Human-only HTTP behavior covers connection state, start/check verification,
change number, disconnect, and conversation deletion. Scoped behavior covers
conversation reading and sending. Provider ingress is isolated under dedicated
Twilio webhook endpoints and never accepts ilo session or agent credentials as
a substitute for a valid Twilio signature.

### `read_text_conversation`

This MCP tool requires `texting:read`, is annotated read-only, and accepts:

- `afterCursor` or `beforeCursor`, but not both;
- `limit` from 1 through 100, defaulting to the newest 100 messages.

It returns a stable ordered page, opaque earlier/newer cursors, masked connection
context, and temporal context with:

- `asOf`: the API's current ISO 8601 instant;
- `timeZone`: the effective IANA time zone from the authenticated MCP request,
  falling back to the account planning time zone;
- `currentLocalDateTime`: the full localized weekday, date, time, UTC offset,
  and time-zone abbreviation;
- every message's canonical ISO 8601 `occurredAt` and full localized
  `localDateTime` in that same zone;
- outbound `sentAt` and `deliveredAt` lifecycle timestamps when known;
- `hasEarlierMessages` so an agent knows when relevant history is paginated;
- a short-lived `conversationReceipt` only when neither cursor is supplied and
  the response therefore contains the newest page.

Inbound `occurredAt` uses Twilio's authenticated provider time when available
and otherwise ilo's durable receipt time. Outbound `occurredAt` is the durable
API submission time. The structured result labels this source rather than
presenting inferred precision. Full dates, offsets, and zones prevent midnight,
daylight-saving, and relative-time ambiguity.

The conversation receipt is signed by the API, expires after five minutes, and
is bound to the user, access-token ID, connection/consent epoch, effective time
zone, and exact conversation revision returned in the read. It does not mark
messages read, consume them, claim them, or hide them from another agent.
Cursor-based older or incremental reads do not qualify a send because they do
not show the complete latest context window.

A cursor orders by a stable `(occurred_at, id)` tuple rather than an editable
provider status. The tool description requires the agent to inspect relevant
earlier pages when `hasEarlierMessages` is true and the recent page does not
provide enough context. The API can enforce that the latest state was delivered
to the agent; it cannot truthfully prove subjective comprehension, so the MCP
contract states that limitation rather than claiming otherwise.

### `send_text_message`

This MCP tool requires `texting:write` and accepts a non-empty `body`, the opaque
`conversationReceipt` returned by the immediately preceding qualifying read,
and these constrained controls when applicable:

- `contentKind`: `concise` by default, or `essential_context`,
  `structured_data`, `requested_large_content`, or `safety_critical`;
- a server-issued length-review or exceptional-confirmation token when the
  graduated length gates require one;
- `seriesTotal` from two through three only when opening an eligible structured
  series;
- a server-issued series ID and exact next part for an already opened
  structured series.

There is no recipient, sender, schedule, media, arbitrary bubble count, or
provider argument. It is an external-world mutation and is not marked read-only
or idempotent at the MCP semantic level.

The API rejects an absent, expired, wrong-token, wrong-time-zone, or stale
receipt with `conversation_read_required`. If any inbound or outbound message
was stored after the read, the API returns `conversation_changed` and the agent
must read again before sending. The receipt check and pending-message insert use
one locked transaction, so concurrent sends cannot both use the same revision.
The successful send itself advances the revision, making one qualifying read
authorize at most one new message. Idempotent transport replay of that same
logical send returns its existing message before receipt freshness is
re-evaluated.

The API constructs the complete provider body before evaluating length. The
count includes API-owned sender/opt-out copy and any series label. It applies
Twilio Smart Encoding's documented substitutions, detects GSM-7 versus UCS-2,
and uses the 160 GSM-7 or 70 UCS-2 single-segment limits, followed by the
US/Canada toll-free concatenation budgets of 152 GSM-7 or 66 UCS-2 characters
per segment. The final body may not exceed ten predicted segments or Twilio's
provider maximum. Consequently the exact agent-body budget is dynamic;
validation reports it before making a provider call.

The first outbound message of every new verification or START consent epoch
identifies ilo and includes the required `Reply STOP to unsubscribe` language.
The API owns this envelope; agents cannot remove or modify it. Subsequent
messages retain ilo sender identification appropriate to an ongoing
conversation.

The result is the durable ilo message, its current delivery state, predicted
segment count, actual count when already known, and a masked provider-safe
failure. It repeats the message's canonical and localized timestamps so the
agent does not lose temporal context. Accepted or queued is not represented as
delivered.

## SMS agent-writing standard

The SMS tool optimizes for useful information per unit of human attention, not
for raw character compression. Concision must reduce reading effort without
using unexplained abbreviations, text-speak, or ambiguity.

For an ordinary response the agent must:

1. Send exactly one bubble.
2. Lead with the answer, result, decision, or required action.
3. Convey one main idea and include only details that change understanding or
   action.
4. Prefer exact names, quantities, dates, deadlines, and next steps over vague
   references.
5. Remove greetings, sign-offs, filler acknowledgements, repeated prompt
   context, and narration about what the agent is doing.
6. End with no more than one clear question or requested action.

The plain-text format contract is:

- no Markdown headings, emphasis markers, tables, or code fences;
- at most three short paragraphs for an ordinary message;
- short numbered list lines such as `1)` when sequence matters, normally no
  more than five items;
- no decorative line art or repeated punctuation;
- no emoji unless it materially carries meaning and matches the user's
  established style;
- ordinary English punctuation should remain GSM-7 where possible, while
  intentional non-English language and accessibility characters are preserved;
- relevant times use the conversation's explicit local date/time context and
  include a date or time-zone abbreviation whenever relative wording could be
  ambiguous;
- links use a full trusted or ilo-branded domain, never a shared public
  shortener or an obfuscated redirect;
- no OTPs, access tokens, secrets, full financial account numbers, or other
  unnecessary sensitive identifiers.

The agent should combine acknowledgement with substance: `Done - ...` is useful
when it reports a real result; a standalone `Sure`, `Got it`, or `Happy to help`
is not. If a complete answer cannot fit the normal budget, the agent first
sends the most decision-relevant summary and asks whether the user wants the
detail unless the user already requested it or delay would create a safety
risk.

### One-bubble rule and structured series

One Programmable Messaging create call is one ilo message and is intended to
appear as one handset bubble even when carriers transport it as multiple
billable segments. Reassembly is not universal, which is another reason to keep
segment counts low. Concatenation is not treated as permission to send a
sequence of separate messages.

A second outbound message within the same five-minute response window is
rejected with `single_bubble_response_required` unless the first message opened
a server-tracked series with `contentKind` equal to `structured_data` or
`requested_large_content`. The first series send declares the total, from two
through three. The API issues the series ID and prepends an immutable sequence
label such as `(1/3)`. Each following part requires another fresh conversation
read, the exact next part, and the same access token. An intervening inbound
message cancels the series so the agent must address the new context rather than
blindly continue.

The agent must use the fewest series parts that preserve comprehension. Content
requiring more than three bubbles is summarized first; the agent asks whether
to continue rather than opening a longer automatic sequence.

### Graduated segment gates

The gates apply to the final encoded body of each bubble:

- **One or two segments:** normal send. One segment is preferred when it can
  remain clear and complete.
- **Three segments:** allowed without a stop, but classified as the upper end of
  normal and measured separately.
- **Four through six segments:** the first attempt returns
  `long_message_review_required`, the encoding/count, a two-segment compression
  target, and a signed review token. Resubmission requires a non-`concise`
  content kind and a short necessity explanation bound to the unchanged body.
- **Seven through ten segments:** after the normal length review, the API returns
  a second `exceptional_length_confirmation_required` stop. The final send is
  allowed only for `structured_data`, `requested_large_content`, or
  `safety_critical`, with a signed exceptional token bound to the unchanged body
  and justification.
- **More than ten segments:** rejected with no override.

Review and confirmation tokens are short-lived and bound to the access token,
body hash, and conversation receipt. A stop does not send or persist a message,
advance the conversation revision, consume the read receipt or idempotency key,
or reserve quota. Changing the body recomputes its segment class and invalidates
every earlier length token. The API audits the category and gate outcome but
never the free-text necessity explanation.

## Limits and cost controls

Before calling Twilio, the service uses GSM-7/UCS-2-aware estimation against the
final provider body and reserves the predicted segments transactionally. It
reconciles the reservation with Twilio's actual segment count when available.

- Maximum 5 outbound messages per account in a rolling minute.
- Maximum 100 outbound SMS segments per account in a rolling 24 hours.
- Maximum 3 bubbles in a server-tracked structured series and 10 predicted
  segments in any bubble.
- Verification endpoints have separate per-account, per-fingerprint, and
  trusted-client-IP abuse limits and rely on Twilio Verify's protection as an
  additional layer.
- A deployment-level circuit breaker can disable all outbound texting while
  leaving history reads and inbound storage available.
- Provider account limits remain a final backstop, not the product's primary
  quota mechanism.

Rejected attempts return structured MCP/API errors and record a redacted audit
event without calling Twilio or consuming a message quota. Verification traffic
has a separately observable budget.

## Idempotency, callbacks, and failure handling

The typed API client generates an opaque idempotency key for each logical send
and reuses it for safe transport retries. The API scopes the key to the stable
user/token identity and operation and transactionally stores it with the
pending message and audit event. Reusing a key with the same body returns the
existing message; reusing it with a different body returns conflict.

Twilio does not provide an application idempotency key for Message creation.
If its create call times out before ilo receives a `MessageSid`, ilo marks the
attempt `unknown` and does not automatically resend. This favors avoiding a
duplicate text over silent at-least-once delivery. The result explains that the
delivery outcome is unknown and exposes the durable message to later inspection.

Status callbacks validate signature, account, sender, destination, and
`MessageSid`. They advance only through the allowed state graph. Duplicate or
older callbacks are successful no-ops. Terminal failure preserves a safe Twilio
error code. Error `21610` additionally applies the consent transition before
returning.

Event Streams uses a dedicated webhook Sink with sink-specific Basic Auth and
Twilio signature validation over the exact configured sink URL and raw JSON
body. The implementation iterates the CloudEvents array, pins the documented
inbound-message schema version selected during provisioning, validates every
event, and deduplicates its CloudEvent ID. IP ranges may be an additional
defense but are not authentication.

All webhook signature calculations use the configured public API URL, never
untrusted forwarding headers. Handlers accept documented additive provider
fields, durably commit before success, and respond within Twilio's timeout. An
invalid signature is rejected without parsing or logging sensitive fields.

Provider outage or unhealthy reconciliation fails sends closed while leaving
reads available. No raw Twilio response, credential, full phone number, or
message body enters an audit record, structured log, metric label, or MCP error.

## Settings experience

Settings includes a Texting connection surface with these honest states:

- not connected;
- verification pending;
- verified and active;
- opted out at Twilio;
- provider synchronization problem;
- administratively suspended.

Setup presents consent copy, phone entry, and OTP confirmation. Active state
shows the permanent ilo toll-free number, the masked personal number, current
consent/provider state, verification time, and which access tokens have Texting
scopes. Opted-out state shows only the instruction to text START to the ilo
number. Provider error state explains that agents can still read history but
cannot send.

Settings offers change number, disconnect, and destructive conversation
deletion with deliberate confirmation. Short-lived success and failure use
toasts; persistent opt-out or provider problems use actionable inline state.
There is no web conversation view in version 1 because the phone is the human
surface.

## Audit and observability

Every outbound attempt records actor, token, policy, request ID, entity, result,
and redacted before/after state. Verification activation, number replacement,
disconnect, deletion, consent transitions, administrative suspension, quota
rejection, provider uncertainty, and provider recovery are also auditable.

Operational metrics and structured logs contain counts and opaque identifiers,
not bodies or full numbers. They cover:

- verification starts, approvals, expirations, and abuse rejection;
- invalid signatures and unmatched masked senders;
- webhook/Event Streams duplicates, age, and processing failures;
- consent transitions and `21610` reconciliation;
- accepted, delivered, undelivered, failed, and unknown sends;
- predicted versus actual segments and the distribution across one-to-two,
  three, four-to-six, and seven-to-ten segment classes;
- length-gate stops and overrides, plus series starts, completed parts, and
  inbound cancellations, without message bodies or necessity explanations;
- account throttles and circuit-breaker use;
- callback lag and provider synchronization health.

Alerts fire for sustained invalid signatures, webhook sink failure, consent
reconciliation failure, elevated delivery failure, quota anomalies, provider
credential failure, or messages stuck pending/unknown beyond the operational
threshold.

## Configuration and provider provisioning

Texting is disabled unless all required configuration is present. Production
configuration includes a Twilio Account SID, restricted API key and secret for
outbound/Verify operations, the Twilio Auth Token required for request signature
validation, Verify Service SID, Messaging Service SID, verified toll-free
number, Event Streams sink credentials, a dedicated phone-fingerprint HMAC key,
a dedicated short-lived conversation-receipt signing key, and the exact public
webhook URLs. Secrets remain outside the repository and are never exposed to
clients.

Before enabling the feature, operations must:

1. Create the Twilio Messaging Service and permanent toll-free number.
2. Complete the Twilio Customer Profile and toll-free messaging verification
   for the documented ilo conversational-agent use case.
3. Configure the number in the Messaging Service sender pool.
4. Enable Smart Encoding on the Messaging Service and prove the connector's
   estimator matches its documented substitutions and toll-free segment counts.
5. Configure signed inbound and delivery-status callback URLs.
6. Provision the authenticated Event Streams webhook Sink and subscribe to the
   selected inbound-message schema version with `optOutType`.
7. Create the Verify Service and apply supported fraud protections.
8. Publish matching consent, privacy, support, and opt-out language.
9. Prove STOP, blocked send, START, and resumed send on real US and Canadian
   handsets before production access is exposed.

## Verification strategy

Automated coverage includes:

- Domain tests for phone normalization constraints, cursor contracts, Smart
  Encoding/GSM-7/UCS-2 and toll-free segment estimation, all graduated length
  gates, series constraints, and every consent/state transition including equal
  and out-of-order STOP/START.
- Connector tests using official-shaped Twilio fixtures for Verify, Message
  creation, webhook signatures, status normalization, Event Streams parsing,
  additive fields, and provider errors.
- Migration/repository tests for encryption, keyed lookup, active uniqueness,
  cascading account deletion, preserved history on disconnect/change,
  destructive history deletion, deduplication, and quota reservations.
- API integration tests for human-only setup, scope isolation, arbitrary-number
  rejection, mandatory read scope, signed conversation receipts, receipt expiry,
  wrong-token and stale-revision rejection, inbound/read/send races, concurrent
  one-receipt sends, one-bubble enforcement, series creation/order/cancellation,
  length-token body binding and expiry, idempotency conflicts/replay, rate
  limits, circuit breaking, callback ordering, `21610`, invalid signatures,
  unknown send outcomes, and fail-closed provider state.
- MCP contract tests proving the server calls only the typed API, offers no
  recipient argument, cannot send without a qualifying read, includes explicit
  current/message timestamps, describes and exposes the SMS writing contract,
  preserves every graduated stop, annotates reads/mutations accurately, and
  preserves structured authorization/provider errors.
- Testing Library coverage for every Settings state, OTP flow, opt-out
  guidance, destructive confirmation, keyboard operation, and status messages.
- End-to-end tests with a deterministic fake Twilio adapter for setup, polling,
  sending, number change, disconnect, and deletion.

A separate pre-production acceptance checklist uses real Twilio Verify and the
verified toll-free sender to test inbound routing, delivery callbacks, Event
Streams, duplicate delivery, STOP, a locally blocked send, provider error
`21610`, START, resumed delivery, segment accounting, and redacted telemetry.
The implementation runs focused suites during development and `pnpm verify`
before handoff.

## Rollout

1. Land domain, migration, connector contract, service, and webhook behavior
   behind a disabled Texting capability.
2. Complete Twilio toll-free verification, policies, secrets, callbacks, Event
   Streams, dashboards, alerts, and real-provider acceptance.
3. Enable setup only for internal canary accounts. Confirm opt-out reconciliation,
   quotas, deletion, and provider recovery under production routing.
4. Enable MCP scopes for canaries and inspect delivery and audit behavior.
5. Expand availability gradually while monitoring segment cost, delivery,
   suppression, abuse, and callback health.

Missing or unhealthy provider configuration never degrades to unverified sends.
Disabling the capability stops new verification and outbound sends but preserves
inbound safety handling and existing history until provider routing is removed
in a coordinated shutdown.

## Authoritative Twilio references

- [Verify API](https://www.twilio.com/docs/verify/api/verification)
- [Messages resource](https://www.twilio.com/docs/messaging/api/message-resource)
- [Inbound message webhook](https://www.twilio.com/docs/messaging/guides/webhook-request)
- [Messaging webhook security](https://www.twilio.com/docs/usage/webhooks/webhooks-security)
- [Outbound message status](https://www.twilio.com/docs/messaging/guides/outbound-message-status-in-status-callbacks)
- [Toll-free verification](https://www.twilio.com/docs/messaging/compliance/toll-free/console-onboarding)
- [Twilio STOP filtering](https://help.twilio.com/hc/en-us/articles/223134027-Twilio-support-for-STOP-BLOCK-and-CANCEL-SMS-STOP-filtering-)
- [Error 21610](https://www.twilio.com/docs/api/errors/21610)
- [Inbound Message Event Streams schema](https://www.twilio.com/docs/events/event-types/messaging/inbound-message)
- [Event Streams delivery](https://www.twilio.com/docs/events)
- [Event Streams webhook security](https://www.twilio.com/docs/events/webhook-quickstart)
- [Twilio Messaging Policy](https://www.twilio.com/en-us/legal/messaging-policy)
- [SMS character and segment limits](https://www.twilio.com/docs/glossary/what-sms-character-limit)
- [Messaging Services and Smart Encoding](https://www.twilio.com/docs/messaging/services)

## Writing reference

- [GOV.UK guidance for writing text messages](https://www.gov.uk/service-manual/design/sending-emails-and-text-messages)
