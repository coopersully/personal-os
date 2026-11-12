# Complete Texting toolkit design

> Historical planning context imported November 12, 2026. Current canonical product contracts,
> later accepted decisions, and implementation evidence supersede conflicting assumptions here.
> This import does not authorize Finance/Texting expansion or establish shipped Memory capability.

- Status: Written design for Cooper's review; conversation-level direction approved 2026-09-28.
- Source baseline: `origin/main` at `f918b63a91fd8a997af75e9f14b02f53f4305b49`, merged and
  inspected 2026-10-12. Source evidence is not production proof.
- Reconciliation: [satisfied requirements and revised remaining-work roadmap](../../engineering/finance-texting-spec-reconciliation.md).
  Existing implementation is retained; detailed design choices remain subject to written review.
- Companions: [shared toolkit](2026-09-28-shared-agent-toolkit-design.md),
  [Finance](2026-09-28-finance-toolkit-design.md).
- Canonical contracts: [Texting](../../product/texting-operations.md),
  [ADR 0006](../../architecture/0006-texting-inbox.md).
- Target behavior only. No real message, provider configuration or runtime change is authorized
  by this document. Implementation plans follow written-spec review.

Detailed completion contracts and task plans were requested on 2026-10-12. Read the
[completion specification](2026-10-12-finance-texting-completion-design.md) and
[implementation map](../plans/2026-10-12-finance-texting-completion.md) with this design.
The new documents refine remaining work; product implementation has not begun.

## 1. Purpose and ownership

Texting gives the person one durable conversation with their external agents through nohmi.
It supports replies to outstanding work and unsolicited requests across all authorized workspaces.
nohmi receives, stores, exposes, binds, validates and delivers. External agents understand
free-form messages, choose domain operations, ask clarifications and compose substantive replies.
nohmi will never contain a built-in agent or substitute one when a caller is absent.

Texting is a shared channel, not a workspace or a competing Finance ledger. Workspaces retain
their records, semantics, rules, approvals and verified effects. The account's shared brain keeps
permitted knowledge and work across agents and sessions. SMS history is evidence, not automatic
trusted knowledge or permission to expose unrelated workspace data.

A user may text “That dinner was reimbursable,” ask a financial question, or make a task/calendar
request. nohmi makes the message available. An authorized external caller decides its meaning and
uses the toolkit. Success means no lost work, honest states, safe execution and usable tools—not
a guaranteed response time from an external agent.

## 2. Foundation and remaining work (2026-10-12)

| Satisfied source capability | Remaining completion |
| --- | --- |
| Verified Twilio transport, signed webhooks, consent/STOP/START, guarded manual read/send and public SMS disclosures | Authorized real provider/sender/carrier/consent evidence; no activation by documentation |
| Registered real Finance resolver, notification discovery/publication/drain and quiet/reminder controls | General workspace producers, generic controls and adaptive/check-in preferences |
| Exact Finance question answers and restricted categorization approve/reject | Generic inbox/new-request handling and broader supported reversible proposals; bare yes still does not approve |
| Signed `Finance:` prospective context with immutable routing/completion receipts | General interpretation by external agents, matching and shared knowledge beyond verbatim notes |
| Durable acknowledgments, exact reply status, startup/tick bounded recovery and shutdown fencing | Generic external claims, work discovery, coordinated replies and complete navigation/retention coverage |
| Persisted accepted-answer host continuation and explicit recovery | Vendor-neutral polling/handoff contract; current bound runs reject another connection |
| Workspace-scoped Reviews dialog/drawer and Finance history | Unified multi-workspace review destination and remaining generated-link repairs |

`app.ts` now injects `resolveFinanceWorks` and composes context, acknowledgment, host and notification
phases. `main.ts` invokes bounded background recovery; the earlier unscheduled-T2 and missing-T0-
producer descriptions are historical. Do not rebuild these components. Preserve their transactional
admission, uncertain-delivery and shutdown safety tests while extending the tooling around them.

Finance SMS is still behind default-off `FINANCE_SMS_ENABLED`, transport enablement and consent.
Source/runtime composition and local provider-double tests do not establish real delivery. General
Texting discovery/claim/maintain tools and a cross-agent knowledge service are still missing.

## 3. Inbound lifecycle

1. Authenticate and bound the provider webhook. Deduplicate by authoritative provider identity and
   owner mapping. Persist the message and durable work availability before acknowledging the
   webhook; the transport acknowledgment does not mean an agent has read or completed anything.
2. Handle provider consent keywords deterministically. STOP/START remain authoritative consent
   events, excluded from conversational inference. Respect provider occurrence ordering.
3. Apply only explicit deterministic bindings: a reply selector and bounded answer can reference
   an exact active question/proposal. Unbound or ambiguous text stays available for an external
   agent. Do not use a model to classify or route it inside nohmi.
4. Expose pending messages with bounded context, current bindings and processing state. An
   authorized caller can claim work with an expiring fenced lease. Other authorized callers can
   still inspect it; they cannot duplicate the claimed mutation or response.
5. The external agent interprets the request, retrieves permitted knowledge, submits typed child
   operations and writes a response. Structured routing validates ownership, scope and revisions.
6. Persist child receipts and unresolved siblings separately. An agent may record a clarification
   question or a response while the underlying request remains unresolved.
7. Mark handling complete only against the expected conversation revision and verified child
   results or explicit waiting/unsupported disposition. Preserve pending work for another session.

The webhook creates durable availability promptly; agent retrieval may be polling or optional event
delivery. Neither path requires a registered host or schedule. nohmi can run deterministic receipt
reconciliation, expiry and transport recovery internally. It cannot perform missing agent reasoning.

## 4. Work discovery, context and new requests

Expose bounded pending-message discovery, exact message/work inspection, claim/renew/release,
recorded response/result, and recovery through authenticated API and MCP. These are target
capabilities, not declarations of existing tool names. Cursor progress is not processing completion.

Return local and UTC times, conversation revision, message provenance, relevant outstanding work,
current delivery/consent state, permitted next actions and bounded source links. An SMS read scope
does not confer Finance or other workspace access. The agent obtains additional purpose-bound
knowledge through shared tools and its current scopes. It may retrieve permitted work authored by
another agent or an earlier run on the account without receiving that agent's credentials.

For multi-workspace requests, the agent supplies linked typed child operations. nohmi validates and
records each independently, preserves verified successes and provides a consolidated state for
the agent's reply. Unavailable capabilities and blocked scopes are explicit. A failed calendar
change cannot undo an unrelated completed task merely to simulate atomicity.

Routine deterministic notifications can use safe templates. Conversational summaries, new request
interpretation and substantive answers are external-agent outputs. Context and work records must
remain useful without requiring a complete transcript in every agent prompt.

## 5. Exact questions and reversible approvals

An outbound actionable message binds to owner, verified recipient/consent epoch, domain work ID,
question/proposal revision, expected answer form, expiry and message identity. Sender-provided text
cannot redefine the effect. Display the action and consequence using canonical proposal fields.
Agent wording may add explanation but cannot replace or obscure the authoritative approval text.

A direct bounded answer such as `yes` is acceptable only for one unambiguous, current bound item.
Multi-item messages require explicit selectors. Free-text facts may be saved with their original
provenance, but an agent's paraphrase cannot manufacture a user approval. If free-form wording is
not in the accepted approval vocabulary, the agent requests a new exact confirmation or sends the
person to authenticated app review. A user's statement of a fact does not activate a rule or budget
authority. Ambiguous, superseded, expired or unknown references never retarget to newer work.

Preserve existing causal safeguards: the binding must exist before the inbound claim, and trusted
provider occurrence evidence must establish that the outbound preceded the inbound. Equal or
missing provider creation times cannot silently pass. Inspect exact receipts first; then expose a
clarification/resend path rather than endless retry when ordering cannot be established.

Approval and effect admission validate current scope, channel consent, exact proposal, domain
policy, revision and idempotency under the required locks. Deterministic bounded responses may be
applied through the same domain operation without new model reasoning. Stronger actions—new rules
or budget authority, credentials, scope/recipient changes, unsupported or irreversible effects—use
their stronger approval path. Global review bypass does not override any of these checks.

User-origin SMS authority and an agent's credential authority remain distinct. An agent cannot
label arbitrary supplied text as a verified SMS event. Server-owned provenance and exact claim
admission establish that source; ordinary agent calls retain their own permissions. Completed
receipts remain authoritative after later transport failures or connection revocation.

## 6. Outbound policy and adaptive coaching

Keep verified recipient consent, encryption, provider authenticity, read-before-send receipts,
bounded length and timeouts, persisted queued state and delivery reconciliation. Every send is
attributable to its actor, channel, work and conversation revision. Proactive messages and replies
must be explicitly distinguished; a caller cannot evade proactive policy by claiming a reply without
a qualifying recent inbound reference.

Shared preferences define adaptive coaching and optional daily check-ins. External agents choose
questions based on saved goals, knowledge and unresolved work, becoming quieter as uncertainty
shrinks. nohmi enforces notification eligibility and remembers what was already asked. It does not
schedule daily reasoning, invent coaching questions, or claim a check-in will occur without a caller.

Default behavior is questions/actions only. Routine success is quiet. Optional check-ins are an
explicit preference with duplicate suppression by check-in period; they do not reset reminder
history for unresolved work. Default quiet hours remain 10 PM–8 AM in the user's timezone and the
default unchanged-item reminder interval remains seven elapsed days, with custom/never options.
Replies to a current user-initiated conversation are exempt from quiet-hour deferral once submitted;
this is a channel policy, not an agent response-time guarantee.

Register real per-workspace work resolvers for typed notification intents. Only authoritative work
state and disclosure determine eligibility. Before delivery, revalidate consent, revisions, expiry,
quiet hours, reminder history and current local date. Suppress resolved work; consolidate eligible
items rather than send a text per item or workspace. Detailed context remains subject to privacy
ceilings regardless of caller wording or per-workspace preferences.

Messages remain concise, contain useful entity context and at most three answerable items, and
link multi-item messages to unified Reviews. A self-contained single question needs no extra link.
Links carry no credentials or approval authority; authentication returns the person to the intended
destination. Consent, inbound workspace access, proactive notifications, bounded replies, detail
and links have visible global settings and explicit per-workspace overrides where applicable.

## 7. Recovery and honest state

Persist a queued outbound before one bounded provider submission. Unknown or queued-without-SID
outcomes are uncertain, not permission to resend. Provider status cannot regress a terminal state.
Claim expiry can recover unsubmitted work, but cannot duplicate an uncertain submission. Inspect
exact domain and provider evidence before replaying any effect.

Persist pending child operations before domain calls; inspect same-key receipts after process
loss. Do not re-execute an incomplete/uncertain receipt or roll back accepted siblings. Failed or
unavailable children remain distinguished from temporary waits. Manual resolution invalidates an
unconsumed proposal; accepted effects remain visible even if a later SMS delivery fails.

STOP, revocation and feature disablement stop new unauthorized work while preserving evidence and
recoverable pending state. Re-enable does not blindly replay old messages. Expired unbound proposals
may be swept, but accepted or uncertain child effects must be reconciled first. Retention cannot
discard records required to resolve outstanding effects; deletion follows the documented owner
deletion path. Configuration and provider repair states remain separate from agent absence.

The app and tools distinguish message received, awaiting agent, claimed, awaiting clarification/user,
operation accepted/applied, blocked, failed, uncertain, and response queued/sent/delivered. Redacted
errors link to ordinary recovery views. A transport acknowledgment never says “budget updated.”

## 8. App and tool experience

Settings exposes verified connection and consent, channel policy, conversation history, delivery
and processing status, and recovery. Unified Reviews projects original domain questions, approvals
and repairs without a second work store. Users can answer or resolve in the app; agents see the
same outcome later. A pending message can show “Waiting for an agent” without claiming which host
is online or when it will answer.

Tools make the next action clear: inspect exact work, reread a changed conversation, reclaim an
expired lease, retrieve a completed receipt, clarify an ambiguous approval or reconcile uncertain
delivery. Capability availability reflects actual providers and registrations. Existing manual
read/send tools remain usable during staged delivery with their current constraints.

## 9. Staging and release evidence

1. **Complete the existing Finance round trip:** retain composed producers, bindings, answer
   admission, acknowledgment and recovery. Add generic fresh-session work access, repair generated
   links and verify authorized real SMS. No named host or automatic agent wake-up is required.
2. **General inbox tools:** pending discovery/claims, unsolicited messages, structured routing,
   clarifications, cross-workspace child results and composed external-agent responses.
3. **Full policy and recovery:** extend existing restricted approvals, add adaptive/check-in preferences,
   cross-workspace aggregation, deterministic catch-up, app controls and retention repair.
4. **Optional events:** publish committed work through the shared authenticated event contract.
   Polling and manual agent invocation remain supported first-class paths.

Tests cover duplicate/out-of-order messages, wrong-owner access, expired/stale bindings, same-second
provider times, missing creation-time recovery, unclear multi-item replies, free-form approval
rejection, manual-resolution races, two agents, lease loss, STOP/START ordering, revocation, disabled
features, uncertain sends, carrier failure, DST quiet hours, midnight rendering and reminder limits.
Use real PostgreSQL concurrency tests, API/MCP contracts, desktop/mobile recovery journeys and
future implementation `pnpm verify` gates.

Production-equivalent proof needs verified provider credentials/sender/recipient consent, signed
inbound and delivery callbacks, public HTTPS/network reachability and one explicitly authorized
real question/answer/resolution journey. A scripted fresh authenticated client can prove toolkit
resumability without certifying a model host. Keep any vendor walkthrough labeled as an optional
interoperability example. Runtime boundaries may still fail despite green mocks; record exact
evidence and honest unavailable states instead of weakening gates.

### Current navigation and authority compatibility

Use the existing Finance-scoped review flow for Finance-only messages. A multi-workspace message
still requires a destination that preserves every requested workspace; `/settings?section=reviews`
and `/reviews` currently fall back to Account and do not satisfy that requirement. Repair assistant,
Texting reply-status and MCP links as one producer-to-browser change. Do not revert the scoped
Reviews dialog/drawer or silently narrow cross-workspace work to Finance.

Preserve new `texting:execute`/`finances:execute` grants and owner-enabled bypass for registered
operations. Phone verification and scope/bypass administration remain owner-only. Exact SMS source
admission is separate from agent-authored arguments; exposing a tool never authorizes forging a
signed inbound source or broadening the currently restricted categorization approvals.
