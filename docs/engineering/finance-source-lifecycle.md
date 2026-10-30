# Finance source lifecycle and repair

Finance preserves useful account and ledger data while exposing incomplete source evidence.
Account balances are observations; account-level trust does not establish that all obligations
are known or that the balance is available to spend.

## Connection and synchronization

Plaid Link uses the existing Transactions connection. The account snapshot returned after token
exchange supplies the selected accounts; the durable Item owns credentials, paging cursor and
sync claims. Newly connected accounts start stale and due for synchronization. Later syncs update
only accounts still attached to that Item. Provider replay, pending replacement and removal use
the existing transaction identities and tombstones.

A missing account in an otherwise healthy Item keeps its account-specific blocked state and last
successful timestamp. Other accounts remain usable. Item-wide failures take precedence over
account shadows, so reconnect and automatic retry guidance refers to the current connection.
Do not turn a successful sibling sync into evidence that the missing account was refreshed.

Manual accounts retain their recorded balances and do not need a provider. Planning summaries
remain qualified when included balances are missing, ownership is unresolved, a source is not
current, a connected Plaid source has never synchronized, or multiple included accounts are
possible duplicates. Empty coverage is not verified zero. Excluded accounts retain inspection
and duplicate warnings but do not contribute to planning totals or duplicate uncertainty among
included accounts. Consult ledger health for elapsed freshness and unresolved ledger work.

## Disconnect and reconnect

Account disconnect stops local synchronization for that account and preserves its transactions,
last recorded balance and stable remote account identity. It removes the canonical Item link and legacy
account credentials. A Plaid account becomes blocked with reconnect guidance and no scheduled
retry. Reconnecting the same remote account reuses its existing ledger identity.

Sibling accounts retain their Item and continue synchronizing. Disconnecting the final attached
account deletes the local Item credential. Disconnect checks tenant ownership and locks topology,
Item and accounts in that order. An active Item or legacy account sync claim rejects disconnect
with a retry-after-sync message; it does not report completion while provider work remains active.
Repeated requests with the same idempotency key return the recorded result without another audit.

The deployment migration detaches accounts left in the exact legacy disconnected shape and deletes
only Items with no remaining account pointer. Healthy siblings keep their Item. The former disconnect
path erased the remote account ID, so those existing accounts cannot automatically recover ledger
identity; reconnect remains explicit and may create a new account record when the provider identity
cannot be matched.

This is local disconnection, not proof of institution-side consent revocation. Manage provider
consent at the institution. The connector does not implement an Item-removal API, and synthetic
tests do not establish real consent, production coverage, reconnect frequency or remote revocation.
Deleting an account is a separate data-control operation with its existing ledger/guidance guards.

## Duplicate detection and reviewed resolution

Plaid account IDs can change across separate authorizations of the same institution login. Retain
optional provider institution ID, account mask, original provider name and persistent account ID
alongside each projection. Existing records remain unchanged until an authoritative account snapshot
supplies this evidence. Only the mask enters the ordinary account response; provider IDs remain
internal. Two populated persistent IDs take precedence, including when they contradict matching
institution/mask/name. Otherwise the complete institution/mask/provider-name tuple supplies a
possible identity match. Institution or editable display name alone cannot block a connection.

Connection hints from Link/Hosted Link can reject a known duplicate before token exchange. The
transactional owner topology lock repeats the check against provider-returned identity before
saving new account IDs; exact-ID relinks retain their ledger. Intentionally stopped records do not
block new consent. Missing hints and concurrent new authorizations can still reach provider exchange
before another local commit; this guard prevents duplicate local projections, not every provider
charge. Both direct Link and hosted completion retain an encrypted exchanged-Item receipt before
account reads and projection. A direct post-exchange failure returns its safe connection ID for
canonical completion; retry reuses that receipt rather than exchanging a consumed public token.
Only successful atomic projection attaches account IDs and clears the receipt. A total credential
storage outage can still prevent retention after the bounded retries; its redacted failure is
reported explicitly. No automatic Item removal or provider consent revocation is implemented.

The account-list duplicate groups combine display-name warnings with retained provider evidence,
so a user rename cannot hide matching provider identities. Groups remain owner-scoped and qualify
planning trust when multiple included records are possible duplicates. Warnings never authorize a
merge or deletion.

The signed-in Accounts page offers **Compare duplicates** and requires choosing a connected,
current account to keep. The server compares owner-scoped ledger entries by date, signed amount,
currency, direction, merchant and pending state, counting matches as a multiset. These are possible
matching charges, not proof that two financial events are identical. Show overlapping and unique
history counts, both account identities, freshness and the consequence before confirmation.

Resolution uses a fingerprint of both accounts, authoritative Item state and complete transaction
row evidence. It rechecks the preview under the owner topology/account/ledger locks and rejects
stale evidence. The attended lock set is capped at 50,000 transaction rows; larger histories require
separate reconciliation. Existing active sync claims reject the operation. The idempotent canonical
account disconnect then excludes only the selected redundant record from planning and stops its
local synchronization. All histories, annotations and relationships remain on their original
accounts. Unique history remains inspectable but no longer contributes to planning; historical
spending totals may change. Keep the healthy account and other attached accounts connected.

This is an explicit source-selection action, not an automatic ledger merge, institution-side
revocation or billing cancellation. Ordinary account disconnect retains its existing separate
planning preference. Read-only tokens cannot resolve duplicates; agent execution retains the
existing Finance execution authority requirements.

## Reconnect and safe test environments

Reconnect for an attached Item uses Plaid Link update mode with the existing access token, omits
new-product configuration and performs no public-token exchange. Completion verifies the owned Item
identity and selected account through bounded provider reads, preserves cursors and user-authored
account details, clears expired claims and schedules synchronization. Authorization verification is
not proof that Transactions synchronization completed. Ambiguous HTTP/server responses retain the
same idempotency key. Intentionally stopped/detached records use fresh consent instead of attempting
update mode against a missing Item.

The connection button labels Sandbox/development test environments. Actual Mac production
environment generation rejects configured Plaid credentials unless both credentials are present and
`PLAID_ENV=production` is explicit; isolated local production-build runtimes may still use Sandbox.
Regression tests use synthetic provider responses and disposable PostgreSQL without Plaid calls.
Optional live Sandbox work uses separate keys, runtime and database under the
[QA fixture contract](qa-fixtures.md); never seed it into production or infer real entitlement from
its success.

The durable commit point is the existing fenced account/Item or account-disconnect transaction.
Identity migration is additive and does not reconcile existing production duplicates. Tests prove
application persistence, owner isolation, retry and UI behavior. After authorized deployment, the
delivery owner separately verifies migration provenance, actual update-mode consent and subsequent
scheduled synchronization, then observes an explicitly approved duplicate resolution preserving
keeper/siblings/history. Billing, provider availability and institution consent require their own
provider evidence. A successful mock or healthy server establishes none of those facts.

## Regression evidence

- `finance/account-disconnect.integration.test.ts`: local access removal, final credential deletion,
  sibling sync, reconnect identity, idempotency, active claims and tenant topology.
- `finance/account-ledger-service.integration.test.ts` and `finance/account-semantics.test.ts`:
  manual ledger preservation, account meaning, exclusion and qualified balances.
- `finance-provider-item-service.integration.test.ts`: durable connection, replay, relink and legacy
  backfill invariants.
- `finance-provider-item-sync-service.integration.test.ts`: initial/later paging, replay/removal,
  pending replacement, missing accounts, retries, reconnect and fenced concurrent projection.

Venmo wallet feasibility remains separate. Institution availability alone does not establish
personal-wallet activity access; no Venmo connector or production consent test is enabled here.

## Blocked preflight recovery

A Finance `start` for the same scope returns the existing blocked run and a scoped
`get_finance_status` next action instead of obscuring its blockers with a rulebook conflict.
`start` and `resume` may update an obsolete rulebook only when the run has exactly one completed
preflight step, its checkpoint agrees, and it has no source snapshot, candidate, execution binding,
non-question action review, recorded transaction revision/relationship effect, or conversation batch.
Recovery is serialized under the owner/run locks and records `finance.maintenance_preflight_recovered`
with the previous rulebook and actual resulting status. It retains the preflight step and every
question. When current blockers remain, the run stays blocked and retains its saved result; only
an unblocked run is queued for synchronization and current candidate preparation.

A validated routine may bind that eligible, previously unbound preflight run to its own active
schedule when it becomes runnable. Existing host bindings retain their original connection and
schedule authority. Recovery neither adopts another host's work nor reinterprets prepared/effected
work under new policy. Later-stage recovery continues through its existing owning workflow.

Planning exclusion is not maintenance exclusion: `includeInPlanning=false` changes planning totals,
not provider authorization or ledger evidence requirements. A replacement connected account does
not repair an older account's authorization. Legacy unverified financial effects still require
explicit financial decisions; review bypass does not establish evidence or resolve these blockers.
A recovered rulebook, queued run, or candidate awaiting challenge is not completed maintenance.

## Legacy action questions and contextual questions

Legacy action questions are stored in `finance_agent_action_reviews` and answered through
`answer_finance_question`. Contextual questions have their own producer, persisted identity, and
answer contract. Passing a legacy action-question ID to the contextual endpoint can return
`producer_not_registered`; that response does not diagnose an unavailable legacy question producer.

New low-confidence categorization questions retain their validated transaction source references.
For older categorization questions with no references, question-list and Finance-status reads may
reconstruct navigation references from the saved, schema-valid input only when every transaction
and account belongs to that question's owner. Missing/foreign targets remain unprojected. This read
repair does not rewrite the question, accept its proposed category, grant another agent answer
authority, or mark it answered. Reconstructed references describe current records, not proof that
old categorization evidence remains valid. Ambiguous transfers and insufficient evidence still
require the existing explicit financial decision and action-policy paths.

Synthetic coverage exercises scheduled start followed by its returned resume action through the
real dispatcher to candidate challenge, with no semantic categorization effects. Production
acceptance separately requires current blocker inspection, authorized source/effect repair, and
observation beyond preflight; these tests do not establish real provider recovery or final settlement.
