# nohmi texting and SMS

- Status: Living target product contract; transport foundation shipped, general inbox pending
- Last reconciled: 2026-09-10

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
available questions or review actions, sensitivity, expiry, and first-party destination; it does
not contain a client-authored procedure or an already-rendered provider message.

The Texting service applies global and per-workspace settings, renders the smallest useful message,
and owns provider delivery. A workspace never calls Twilio, reads the general SMS conversation, or
polls for replies directly.

A maintenance message should normally contain:

- one outcome sentence;
- at most one currently available question or exact review action;
- explicit reply choices when the answer vocabulary is bounded; and
- one short first-party review or recovery link when it adds value.

Example: “Your budget is on track this month. One question: dinner yesterday was unusually large—are
you expecting reimbursement? Reply yes, no, or unsure. Review: [link]”

Messages use privacy-safe language by default. Financial amounts, account details, Mail subjects,
calendar descriptions, and other sensitive content require the person's explicit channel-detail
preference and remain subject to workspace disclosure policy.

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

Review bypass never grants scopes, creates a domain rule, supplies missing facts, or converts model
confidence into authority. Every direct action and SMS approval retains actor, channel, source,
policy, proposal version, conversation revision, effect, delivery, and undo or recovery evidence.

The current implementation's bypass storage and UI are Finances-specific. Promoting review bypass
to a global policy and migrating Finances onto it are target work, not shipped behavior.

## Global defaults and per-workspace controls

The target settings contract is defined in
[`per-workspace settings`](workspace-settings.md). SMS communication preferences are configured
globally and inherited by every workspace; the person may deliberately override a workspace when
it needs different behavior. The configurable preferences are:

- whether general inbound texts may route work into that workspace;
- whether maintenance may send SMS at all;
- whether to send only questions, actionable results, or every completed run;
- whether SMS replies may answer questions and review exact reversible proposals;
- privacy-safe versus explicitly enabled detailed content;
- whether to include first-party review and recovery links; and
- channel-specific quiet hours or the inherited global notification schedule.

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
does not yet provide general-inbox intent classification, work-node answers, cross-workspace child
intents, event-driven agent dispatch, `maintain_texting`, maintenance notification intents,
per-workspace SMS controls, global review bypass, or SMS-bound approvals.

Local tests prove validation, persistence, signed-webhook handling, and degraded provider behavior
with mocks. They do not prove production sender registration, carrier reachability, callback
routing, or STOP/START behavior; production enablement still requires an authorized end-to-end test
that records identifiers, timestamps, and final states without retaining phone numbers or bodies.
