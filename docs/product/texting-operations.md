# nohmi texting and SMS

- Status: Living target product contract; transport foundation shipped, general inbox pending
- Last reconciled: 2026-09-11

## Product role

Texting is nohmi's shared conversational channel. It is a general inbox through which the person can
ask free-form questions, request work from any authorized workspace, answer outstanding questions,
review exact reversible proposals, and receive concise maintenance results with useful links.

Texting is not a fifth workspace and does not own Mail, Tasks, Calendar, or Finances behavior. It
owns conversation state, delivery, inbound processing, intent routing, response composition, and
channel policy; each workspace continues to own its ledger, expertise, authorization, operations,
questions, and definition of maintained.

## General inbox and dispatch

Every valid inbound message enters one durable nohmi conversation. The Texting coordinator should:

1. claim each unprocessed inbound message exactly once;
2. load the bounded conversation and User Knowledge needed to understand the request;
3. distinguish an answer to an existing work node from a new free-form request;
4. route each intent to the workspace or shared service that owns it;
5. create linked child intents when one message spans several workspaces;
6. wait for, resume, or summarize their durable results without duplicating effects;
7. ask one concise clarification when routing or action remains ambiguous; and
8. send one coherent reply with completed work, unresolved questions, and relevant deep links.

For example, “Move tomorrow's meeting and mark last night's dinner reimbursable” becomes separate
Calendar and Finances child intents. Texting coordinates the response but cannot reproduce either
workspace's scheduling or transaction-classification logic.

Inbound processing should be event-driven so a text receives a timely response. A target
`maintain_texting` intent drains unprocessed messages, resumes interrupted child work, reconciles
uncertain delivery, and verifies that every claimed message reached an honest terminal state. A
manual or externally scheduled invocation is a catch-up and recovery path, not the only trigger.

## Workspace maintenance notifications

Every workspace may publish a typed notification intent when setup or maintenance reaches a useful
state. The intent contains the workspace, run and work-node identities, a safe result summary,
available questions or review actions, the minimum useful entity context, canonical timestamps,
sensitivity, expiry, and first-party destination; it does not contain a client-authored procedure
or an already-rendered provider message.

The Texting service applies global and per-workspace settings, renders the smallest useful message,
and owns provider delivery. A workspace never calls Twilio, reads the general SMS conversation, or
polls for replies directly.

Proactive maintenance SMS is quiet by default unless the run needs an answer or action from the
person, such as a bounded question, exact review, connector repair, or recovery step. A routine
successful run or automatically recoverable failure sends no text; Texting still answers messages
the person initiates.

A maintenance message should normally contain:

- one outcome sentence;
- as many currently available questions or exact review actions as remain easy to scan, with a hard
  cap of three and permission to include only one or two when the items need more context;
- the unified Reviews link whenever two or more items are included, plus one brief overflow summary
  when additional items remain or the available items cannot fit cleanly;
- the useful merchant, sender, event, task, or other entity name needed to understand it;
- explicit reply choices when the answer vocabulary is bounded; and
- one short first-party review or recovery link only when additional context is useful, several
  items are involved, or the necessary content is too long for a reasonable text.

Messages are formal, concise, and immediately scannable. They omit greetings, sign-offs,
conversational filler, repeated status, and the full contents of a large queue. A multi-item message
contains no more than three directly answerable items and may contain fewer when clarity requires;
Texting sends one cross-workspace notification rather than one proactive message per item or
workspace.

A short, self-contained single question does not include a redundant link. The message stays brief
and directly answerable by text unless evidence or context is needed to decide safely.

The multi-item link opens the existing unified Reviews destination at
`/settings?section=reviews`, where the person can see all outstanding Review and Attention work
across available workspaces—including questions, approvals, connector failures, and recovery
steps—filter it, and follow each item to its owning domain. A single-item context link may still open
that exact item or owning workspace.

Opening the link requires normal nohmi authentication. The URL carries no bearer credential,
approval authority, answer, or sensitive item content; possession of the phone or receipt of the
SMS is not a web session. If authentication is required, nohmi returns the person to the requested
review destination after sign-in.

Example: “Dinner yesterday was unusually large. Are you expecting reimbursement? Reply yes, no, or
unsure.”

Multi-item example: “Two questions: 1) Archive 18 promotional emails? 2) Move Friday's
dentist event to 3 PM? Reply `1 yes, 2 no`. Review: [link]”

The numeric labels are short references bound internally to the exact message and proposal
revisions; they are not durable public IDs. A reply to one unambiguous active item may use its
bounded answer directly, such as `yes`, `no`, or `unsure`. A message with two or three items requires
the reply to name each answered number so nohmi never guesses which proposal the person approved.

Overflow example: “Several items need review. Review: [link]”

Privacy-safe does not mean context-free. Merchant display names, sender display names, event titles,
task titles, and comparable identifiers are included when they are needed to understand the action;
account numbers, message bodies, event descriptions, and unnecessary sensitive detail remain
excluded unless the person's channel-detail preference and workspace disclosure policy allow them.

### Time and date rendering

Notification intents retain canonical instants and the source time zone. Immediately before the
provider send, Texting converts them into the person's current time zone and uses relative language
for nearby dates: `today`, `yesterday`, or `tomorrow`. It includes a local clock time only when the
decision depends on it and uses an unambiguous weekday or date for events outside that relative
window.

Relative labels are generated by Texting, not supplied by a workspace. If a queued message crosses
a local date boundary before the provider call, Texting renders it again so `today` and `yesterday`
remain accurate; the linked nohmi record preserves the exact date and time.

### Quiet hours

Quiet hours are enabled by default from 10:00 PM through 8:00 AM in the person's current time zone.
The person may change that window or select `any time`, which explicitly disables quiet-hour
deferral.

During quiet hours, proactive maintenance texts wait until the window ends. Before release, Texting
revalidates that each question or action is still current, suppresses resolved or expired items,
recomputes relative dates, and consolidates multiple remaining items into one Reviews notification.
Replies to a conversation the person initiated are immediate and are not proactive maintenance
notifications.

### Reminder suppression

Texting sends the initial actionable notification once. Repeated maintenance runs do not repeat an
unchanged question, review, connector failure, or recovery step; reminder eligibility is attached
to the durable work item rather than the number of times maintenance discovers it.

The same unresolved item becomes eligible for an earlier notification only when new information
materially changes what the person must do or the consequence of acting or not acting. New wording,
evidence, confidence, maintenance rediscovery, or internal progress does not qualify when the
required action and consequence remain the same. An eligible material change still respects quiet
hours and is revalidated immediately before delivery.

An unresolved item may be mentioned again only after the person's configured reminder interval has
fully elapsed. The default is 7 days; the person may choose another interval or `never`, which
disables repeat notifications while leaving the item visible in Reviews. nohmi prefers silence and
a less complete notification history over becoming repetitive or annoying. Before any reminder,
Texting revalidates the item, suppresses resolved or expired work, and consolidates multiple
eligible items into one unified Reviews alert.

## Global review bypass and SMS approval

Review bypass is a global execution setting. It applies consistently to app, API, MCP, scheduled,
and SMS-initiated work; per-workspace SMS settings cannot override it or widen authority.

| Action state | Review bypass off | Review bypass on |
| --- | --- | --- |
| Read-only | Execute | Execute |
| Policy-authorized and reversible | Queue an exact review | Execute directly |
| Missing or ambiguous information | Ask a question | Ask a question |
| Outside scope, unsupported, or blocked | Block | Block |
| Irreversible or explicitly approval-bound | Require its stronger approval path | Require its stronger approval path |

When bypass is off, a verified SMS reply may approve or reject an exact reversible proposal. The
outbound review must bind the reply to one unexpired proposal, disclose the action and consequence,
and accept only its bounded answer vocabulary. A bare “yes” cannot approve an older, superseded,
ambiguous, recipient-changing, scope-changing, credential, irreversible, or unavailable action.

Texting may route any request represented by an MCP-equivalent capability; SMS is not a smaller
domain surface. It still uses the same API policy, provider capability, approval requirements, and
audit contract as app, API, MCP, and scheduled work. Authority remains caller-specific: an inbound
message uses the verified user's Texting identity and channel policy, while an external model or
automation uses its connected-agent credential and scopes. Channel access never creates authority
that the corresponding operation would not have elsewhere.

Cross-workspace child operations settle independently. Texting preserves every verified success
when a sibling operation fails, remains blocked, or becomes uncertain; it retries only safely
replayable remaining work and reports the exact completed, failed, blocked, and uncertain results.
It never describes the whole request as successful when only part of it completed and never rolls
back a verified success merely to make the combined response look atomic.

Review bypass never grants scopes, creates a domain rule, supplies missing facts, or converts model
confidence into authority. Every direct action and SMS approval retains actor, channel, source,
policy, proposal version, conversation revision, effect, delivery, and undo or recovery evidence.

The current implementation's bypass storage and UI are Finances-specific. Promoting review bypass
to a global policy and migrating Finances onto it are target work, not shipped behavior.

## Global defaults and per-workspace controls

The target settings contract is defined in
[`per-workspace settings`](workspace-settings.md). A shared notification policy evaluates the work
item once across SMS, in-app, push, email, and future channels; Texting only decides how an eligible
intent is delivered over SMS. Shared preferences are configured globally and inherited by every
workspace; the person may deliberately override a workspace when it needs different behavior.
SMS-specific controls cannot create eligibility, bypass shared quiet hours or reminder suppression,
widen authority, or exceed the shared privacy ceiling. The configurable SMS preferences are:

- whether general inbound texts may route work into that workspace;
- whether maintenance may send SMS at all;
- whether to keep the questions-and-actions-only default, turn maintenance SMS off, or send every
  completed run;
- whether SMS replies may answer questions and review exact reversible proposals;
- useful contextual identifiers with privacy-safe detail, or explicitly expanded content;
- whether to include first-party review and recovery links; and
- the default 10:00 PM–8:00 AM quiet window, a custom window, or `any time` delivery; and
- the 7-day default reminder interval, a custom interval, or `never` for no repeat notifications.

Custom maintenance instructions are workspace guidance, not Texting configuration. They apply to
every setup or maintenance invocation regardless of whether it began in the app, MCP, an external
schedule, or SMS.

## Current transport foundation

The shipped implementation uses Twilio Programmable Messaging with one shared toll-free sender,
not Twilio Conversations. One verified US or Canadian recipient belongs to one nohmi account at a
time. Phone numbers are encrypted; fingerprints exist only for routing and uniqueness.

Twilio STOP/START state is authoritative. STOP immediately marks the account opted out and only an
inbound START restores it. Provider error 21610 also marks the account opted out. Website
verification records consent but cannot clear a retained provider STOP event.

Inbound webhook bodies are capped before parsing. For each signed inbound message, nohmi fetches
Twilio's provider creation time and orders consent events by that time rather than webhook arrival
time. Delayed START cannot override newer STOP, and STOP wins when provider times tie. Consent
keywords remain consent events only: they never enter the agent-readable conversation or advance
its revision.

Starting verification persists a durable challenge before requesting Twilio Verify. Uncertain
provider outcomes require a new verification request rather than an automatic retry. Disabling
`TEXTING_ENABLED` stops setup and sends while retaining credentials so STOP/START webhooks can
still synchronize.

Every outbound request persists a queued message before making one provider call with a bounded
timeout. A queued message without a provider identifier and an `unknown` result both mean uncertain
delivery: do not automatically resend identical content until provider or recipient evidence
resolves the uncertainty. Status webhooks may advance delivery state but never regress a terminal
state.

Only a current uncursored conversation read issues the short-lived receipt required to send. The
receipt binds user, agent, connection, consent epoch, conversation revision, and time zone, and the
send path revalidates all of them under lock. Every displayed message includes UTC time and an
explicit local offset.

## Current gaps

The shipped implementation provides verification, consent, conversation history, guarded manual
reads and sends, delivery lifecycle, webhook handling, and MCP tools for reading and sending. It
also has the authenticated Settings-owned Reviews destination, which aggregates available Review
and Attention work across the four workspaces with filters and domain-owned action links. Current
sources include reconnect-required Mail and Calendar accounts, but complete connector-failure and
recovery coverage remains target work. Texting does not yet provide general-inbox intent
classification, work-node answers, cross-workspace child
intents, event-driven agent dispatch, `maintain_texting`, maintenance notification intents,
per-workspace SMS controls, global review bypass, or SMS-bound approvals.

Local tests prove validation, persistence, signed-webhook handling, and degraded provider behavior
with mocks. They do not prove production sender registration, carrier reachability, callback
routing, or STOP/START behavior; production enablement still requires an authorized end-to-end test
that records identifiers, timestamps, and final states without retaining phone numbers or bodies.
