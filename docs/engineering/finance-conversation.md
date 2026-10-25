# Finance conversation protocol

The conversation service is an additive extension of canonical `maintain_finances`. It creates no
separate Chat dispatcher. A new eligible run captures a fixed owner-scoped cutoff and membership;
manual or unverified runs leave the queue untouched. Coalescing and resuming reuse the original batch.
Messages arriving later belong to another run. Decimal sequence strings preserve PostgreSQL bigint
precision in the API and clients.

The human owner reads history, sends messages, initiates verification and advances a rendered read
cursor. Agents can only page the saved batch of an existing run under its original schedule and
connection. Page delivery persists exact receipts; acknowledgment accepts only delivered IDs and does
not move the human read cursor. Causal replies reference delivered source messages within the cutoff.
Signed cursors bind owner, run and cutoff. Reusing an idempotency key never creates a second message.

Registration alone cannot unlock sending. The original live host must fetch a server challenge,
acknowledge its exact nonce and persist a harmless response for the current protocol. Handshake
traffic is private capability state, outside history and unread counts. Execution readiness also
checks the original token's maintenance, write and execution grants and the owner's existing execution
policy. Authority loss locks delivery and effects; history remains available to the human.

The MCP adapters expose batch delivery, exact acknowledgment, causal reply and challenge exchange.
All require maintenance, write and execution grants. Batch delivery is marked as a mutation because
it saves delivery receipts. The typed-operation audit names human-only operations explicitly and
never aliases human rendered state to agent acknowledgment. API errors retain structured recovery
information. Human contextual answers reuse the existing contextual-question answer API and its
canonical operation/work revision; the accepted-answer transaction records the same source operation
in conversation history. A caller must not send a second ordinary message for that answer.

Migration `0115_finance_conversation_core` follows the immutable host-prompt and baseline storage
migrations. Owner deletion cascades private conversation state. Deleted source cases clear only the
nullable live link, retaining immutable provenance. Shared migration history is append-only.

Candidate settlement integrates committed financial-effect evidence with the guarded mutation
transaction, as described below. A persisted reply alone is not proof that a financial action
occurred, and it never supplies human budget approval. Other historical financial actions without
a canonical receipt remain outside Activity's current coverage. Source verification and merged
implementation do not establish deployment or an actual supported-host cycle.

## Committed financial-effect readback

Candidate settlement stores its canonical `commit_finance_candidate_effect_v1` mutation receipt in
the same transaction as the existing guarded financial effects and actual audit events. The
candidate/revision key makes a lost response safe to read back without applying effects again.
Optional conversation claims are validated against the original run's delivered fixed batch;
conversation text never supplies budget approval or execution authority. A standalone reply is not
financial-effect evidence.

`get_finance_conversation_evidence` reads one exact run, candidate and revision through the typed
readback route. Its original host must retain maintenance, write and execution grants, current
protocol proof and policy authority. The read never starts a run, scans a live message queue or
replays effects. Signed cursors retain owner/run/candidate scope and page audit and record references
at 100 per response. Missing historical receipts are explicitly unavailable.

Explicit candidate execution recovery uses `get_finance_maintenance_execution_authorization` and
`refresh_finance_maintenance_execution_authorization`. Both require all three current maintenance,
write and execution grants, current policy, the original connection, current protocol proof and
canonical OAuth successor lineage. A binding is initialized only by actual authenticated successful
candidate challenge submission. Historical candidates have no inferred binding. Original actors,
batches and economic receipts remain immutable; refresh never replays financial effects.

Read fresh execution facts before a refresh. Reuse an operation ID only for an exact retry: admitted
pending results remain stable. After control progression, read fresh facts and use a new operation
ID. Active leases remain pending until their deadline; recovery never steals a claim. Server control
uses the existing run and scheduler claim, with bounded retries and explicit reconciliation. A
committed receipt permits only the existing derived completion phases, without economic replay.
Committed evidence may be read by a proven canonical successor under the same current authority
checks while retaining its original actor; this read changes no execution binding.

Protocol challenges use an immutable server generation under the owner guard. The latest generation
supersedes every earlier proof before verification checks; a new unverified challenge blocks older
verified proof. Historical proofs receive no guessed generation: tied latest timestamps fail closed
and require a fresh challenge. Bindings retain the server protocol version at submit and fail closed
on version mismatch. Real challenge timestamps and expiry remain unchanged.

The recovery source has focused verification; actual PostgreSQL races, authenticated transport,
independent review and complete candidate verification remain release gates. Earlier delivery or
readback tests do not prove recovery or complete browser acceptance.

## Human source-message navigation

Activity source links use `/finances/chat?message=<message-id>`. The authenticated human-only
`GET /v1/finances/conversation/messages/:messageId/context` resolves that exact owner message and
at most ten messages on each side (21 total, ascending). Missing and foreign-owner IDs both return
not found. Every surrounding read also filters by owner; agents continue to use saved run batches.
The Chat page focuses the source row while retaining other query context and locked-mode history.
A context jump does not advance the contiguous fetched-history boundary or acknowledge an agent
batch. Only actually visible rendered messages within the contiguous fetched boundary advance the
human read cursor. Lookup failures use Sonner and a retry control; access denial clears private material.

## Human unread attention

`GET /v1/finances/conversation/unread` is human-only and read-only. One owner-scoped SQL snapshot
returns the decimal-string count of agent messages above the human rendered cursor, that cursor,
and the latest agent sequence. Missing cursors start at zero. User notes, private challenge messages,
agent delivery acknowledgments and deletion of a linked case do not change this definition.

The Chat sidebar uses an owner-and-session-mount cache identity, shows a count and attention icon,
and keeps the independent capability lock visible. An unread badge never unlocks sending. Only a
successful human rendered-cursor receipt invalidates the unread projection; agent ACK does not.
Authorization denial clears cached attention; transient read failure retains the last authorized
projection. Large counts remain exact decimal strings in the contract and accessible label.

## Activity financial scope

Activity projects actual completed, applied candidate-effect receipts only after validating their
owner, canonical operation/key, actor, audit membership and immutable message sources. No-change
receipts do not become applied financial actions. Existing canonical human decisions remain visible.
Other historical financial actions without this evidence are explicitly outside the current partial
coverage; neither an agent reply nor a proposed or failed action is inferred to be applied.

Routine actions may group by the exact run and single action family. Mixed-family actions and
budget decisions remain individually inspectable, preserving actual approval provenance, including agent execution under review bypass.
Unknown record kinds remain readable raw evidence and receive no invented routes. Per-action human
`/v1/finances/activity/:id/evidence` reads at most 100 audit/change/reference items per page, with
explicit completeness and an owner/receipt/revision-bound signed continuation. The list never
silently truncates evidence or duplicates actions to represent overflow. PostgreSQL source-binding,
browser and complete candidate verification are separate required evidence.
