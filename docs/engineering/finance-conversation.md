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

The effect-evidence helper is not yet integrated into financial mutation owners. A persisted reply is
not proof that a financial action occurred, and it never supplies human budget approval. Actual
PostgreSQL migration, concurrency, rollback, privacy and deletion evidence, independent review,
complete candidate verification and supported-host observation remain required release gates.
