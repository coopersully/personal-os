# Finance context capture

The internal C1a service stores prospective Finance context without requiring a transaction.
It supports create, complete replacement at an expected revision, cancellation and current reads.
It is not registered as an HTTP/MCP operation or SMS producer in this slice. Connector evidence,
matching, answers to existing work, disputes, reopening and reusable knowledge remain later work.

## Authority and meaning

The service binds an authenticated principal and validates actor/request provenance before receipt
access. Capture requires `finances:write`; current reads require `finances:read`. Tenant identity
comes from the bound principal. A missing or foreign context produces the same not-found result.
Clients cannot supply source, status, actor, revision, timestamps or owner. Category references must
be null and transaction references empty; participants and payment channel are bounded labels.

Expected cents are explicit, nullable and signed safe integers. Unknown stays null. An expectation
never becomes cash, repayment, recognized income or an economic relationship. Absolute validity
instants require an offset and normalize to UTC. Future validity does not imply present applicability.

## Storage and provenance

Migration 0085 adds a tenant-owned current pointer and immutable revision snapshots. Deferred
composite foreign keys require the pointer and its exact same-owner/context revision to agree at
commit. PostgreSQL rejects every snapshot UPDATE. Parent/user deletion may cascade for privacy;
there is no claim that historical rows are protected against privileged direct DELETE operations.

Each snapshot has a server-generated UUID. `FinanceContext.source` contains that UUID and its
positive decimal revision: this identifies the immutable capture, not an external message, bank
transaction or money evidence. Responses validate against the unchanged canonical FinanceContext
schema. PostgreSQL bigint revisions remain bigint/string; overflow fails instead of wrapping.
The append-only audit records revision, status and source identity without copying private text,
participant labels, payment channel or expected amount.

## Transactions, receipts and expiry

Mutations opt into user `FOR KEY SHARE` admission before the existing receipt advisory/row locks,
then lock one context pointer, append a snapshot and compare-and-swap the pointer. Read expiry
uses user admission then the pointer lock. This ownership fence blocks deletion/key changes;
it is not a broad Finance gate. A supplied executor must not already hold later receipt/child
locks before admission. No existing writer or Texting lock protocol changes.

The existing helper stores the direct FinanceContext response under user/operation UUID. Same
canonical input replays the exact historical response, even after a newer revision or expiry.
Changed input conflicts; replay still requires current scope and valid server provenance. Standalone
failures roll back domain changes and independently persist a failed receipt, requiring a new key
for retry. If the owner was deleted before failure recording, no owner receipt can survive and the
original error is returned. Supplied transactions have no independent failure receipt: caller rollback
removes all domain, audit and receipt writes. Results remain provisional until caller commit;
callers must propagate failures and must not acknowledge them externally before commit.

Active contexts may be replaced, cancelled or expired; terminal contexts cannot be reopened.
Clock checks occur after pointer waits. Mutations reject elapsed validity without claiming expiry
was persisted by the failed transaction. A current read materializes one expired snapshot and
commits it before returning when it owns the transaction. This deterministic lifecycle write is
permitted by Finance read scope; it cannot edit captured content. No scheduler is involved.
At stronger supplied isolation, serialization failures require caller rollback rather than success.

## Evidence and limits

Focused tests exercise strict input validation, exact replay, tenant/scope isolation, real PostgreSQL
commit-time foreign keys, immutable UPDATE rejection, privacy cascades, expiry after a lock wait,
competing revision operations, deletion/admission barriers and injected rollback at write stages.
Historical migration fixtures omit 0085 from their pre-upgrade phase so they still exercise actual
upgrades. These tests establish local persistence behavior, not production activation or a complete
Finance context/answer workflow.
