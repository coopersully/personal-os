# SMS agent conversations

Status: implementation authorized by Cooper on November 5, 2026, across all authorized workspaces.
Tracking: COO-61 — Complete shared Texting general inbox and cross-workspace routing.

## Outcome and approach

A person texts the verified nohmi number from their personal phone. nohmi stores the conversation,
wakes an existing Claude routine into a new session, and shows history and truthful processing and
SMS delivery state in the app. Continuity belongs to nohmi, not a retained provider session.
Cooper selected the existing cloud routine; a personal CLI runner adds machine availability and
credential management, and a direct model API introduces separate usage charges.

Reuse canonical SMS messages, signed inbound claims, consent epochs, and existing routine
registration. Add an explicit human opt-in binding to a routine already registered by the owner.
The agent needs Texting read/write/execute grants; every workspace independently enforces its
current permissions. A routine token authorizes waking only. Never broaden scopes or infer approval
from a message, generated reply, or knowledge. Existing exact Finance question replies remain owned
by Finance; new general requests may span Mail, Calendar, Tasks, Finances and shared services.

## Durable lifecycle

Persist a queue entry in the inbound transaction. Group up to 25 messages after a five-second
burst window. One unfinished run per owner prevents overlapping automatic work. Before transport,
commit a submitting run and its fixed input membership. Recheck consent, schedule and live grants
under locks before bounded provider handoff. Send identifiers, not message bodies, to the routine
fire endpoint. Never automatically repeat a submitting/uncertain handoff: the provider has no
idempotency key. A definite rate-limit rejection may retry after its bounded backoff. Expired or
revoked authority stops new work; human history remains accessible.

An authenticated agent claims an exact run using an invocation UUID. Replaying the same claim
returns the same batch; a competing invocation cannot acquire it. It reads recent history through
existing Texting APIs and obtains current workspace state using their tools. Durable per-workspace
notes record pending, completed, blocked or uncertain work and source references. These notes are
agent reports, not independently verified effect receipts. Domain records remain authoritative.
Pending work is paginated across sessions; each run can checkpoint up to 100 work records in
batches of 20. General inbox routing takes precedence unless a Finance response matches a bounded
choice or explicitly identifies a numbered request. Consent cancellation preserves queue ownership.
The agent records a concise reply through the coordinator; the outgoing SMS record and completion
are committed together before provider submission. Uncertain sends never auto-resend. Unknown
execution is surfaced for inspection, never automatically restarted with possible duplicate effects.

## App experience

A shared Messages destination shows chronological inbound and outbound SMS bubbles, local times,
delivery status, older history, and a compact agent-processing summary. It is an account utility,
not a fifth workspace. Texting settings select an existing routine and explain usage and permissions.
History stays readable while disconnected or blocked. Page queries are owner scoped; mutation
feedback uses Sonner. The first version is a history viewer; the personal phone is the composer. Run history is separately
paginated so older failed runs remain recoverable. Only definite rejected submissions can be retried;
unknown execution requires human confirmation that the host stopped before closing.

## Cost and boundary

Use only the existing subscription-billed routine fire endpoint. No model API key, local runner,
or paid fallback. Enabling requires confirmation that Claude paid extra usage is disabled; nohmi
cannot inspect or enforce account billing settings. Subscription limits can delay responses; SMS
provider charges remain separate. The official endpoint is experimental, fixed HTTPS/443, with a
15-second bounded request, no redirects and at most 16 KiB response. Provider acceptance is only
session creation, never proof of work or reply delivery.

References checked November 5: https://platform.claude.com/docs/en/api/claude-code/routines-fire
and https://code.claude.com/docs/en/routines.

## Acceptance and rollout

Prove duplicate webhook handling, tenant and connection isolation, STOP/reconnect epochs, revocation,
competing dispatchers/agents, fixed batch membership, rate limiting, uncertain transport, crash after
claim, reply atomicity, pagination, and desktop/mobile history. Preserve existing Finance handling.
Use additive migrations and explicit configuration; no historical inbound backlog is automatically
executed. A real routine and SMS round trip, account billing configuration and production permissions
remain separate release evidence. This assignment does not authorize production sends or merge.
