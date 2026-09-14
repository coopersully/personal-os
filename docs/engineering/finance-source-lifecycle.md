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
