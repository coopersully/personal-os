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
