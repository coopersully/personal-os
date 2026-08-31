# Finance Account Semantics and Planning Context Design

**Status:** Approved in conversation

**Date:** 2026-08-27

## Objective

Make Finance account balances trustworthy and easy to use for planning. Plaid account type evidence
must determine whether an account is cash, an investment, debt, or another asset; user-owned
planning inclusion and ownership must remain explicit; wealth reporting must disclose unresolved
account semantics rather than presenting a false precise total; and MCP callers must be able to
find relevant accounts without scanning an unstructured list.

## Problem

Plaid account snapshots currently omit provider `type` and `subtype`. Persisted Plaid accounts
therefore retain the database default `cash` kind. In production this caused IRAs and brokerages to
appear as cash, credit-card balances to appear as positive assets, and the wealth summary to report
zero investments. A flat account list also forced callers to inspect every account manually.

Account kind alone is not enough for planning. A person may exclude an account, hold only part of
a joint account, or have an unresolved ownership share. Wealth reporting currently has no way to
represent those facts or disclose that its total depends on an unresolved assumption.

## Scope

### Provider account semantics

The Plaid connector will project the provider's account `type` and nullable `subtype`. The Finance
domain will retain a bounded provider-type vocabulary:

- `depository` maps to `cash`;
- `investment` and `brokerage` map to `investment`;
- `credit` and `loan` map to `debt`;
- `other` maps to `other`.

Plaid balance signs remain provider evidence. Wealth reporting treats the absolute balance of a
`debt` account as a liability and subtracts it from net worth. It does not rewrite provider
balances to a synthetic negative number.

Accounts record `kindSource` as `provider`, `user`, or `default`. A provider refresh may update
kind only when the source is not `user`; a user correction remains authoritative across later
Plaid synchronization.

### Planning ownership and inclusion

Each account records:

- `includeInPlanning`, defaulting to `true` for backward compatibility;
- `ownershipType`: `individual`, `joint`, or `unknown`;
- `ownershipShare`: nullable decimal from 0 through 1.

The merged state obeys these invariants:

- an individual account has share `1`;
- a joint account requires an explicit share greater than 0 and at most 1;
- an unknown account has a null share;
- an excluded account does not affect planning totals but retains its metadata and ledger.

New manual accounts default to individual ownership with share 1. Existing accounts and newly
connected provider accounts default to unknown ownership with a null share until the user confirms
them; the migration does not guess legacy intent from account names or provider fields.
Provider synchronization never changes ownership or inclusion.

### Account discovery

The public Finance account list accepts optional `query`, `kind`, `status`, and
`includeExcluded` filters. It returns:

- matching account rows;
- planning totals split into cash, investments, debt, other assets, and net worth;
- excluded account IDs;
- unresolved account IDs;
- possible duplicate groups based on normalized institution and account name.

Duplicate groups are warnings only. This change does not merge accounts or ledger rows.

The MCP `list_finance_accounts` tool exposes the same filters and structured summary. MCP remains
a stateless adapter over the typed API.

### Trustworthy wealth reporting

Wealth reporting uses only included accounts and applies the stored ownership share. Individual
accounts use share 1; joint accounts use their confirmed share. Unknown ownership is conservatively
included at full balance for backward compatibility, but the account is listed as unresolved and
the account-semantics trust flag is false.

The wealth response adds an `accountSemantics` object containing excluded IDs, unresolved IDs,
possible duplicate groups, and a `trustworthy` boolean. Existing top-level totals remain for
compatible callers. A caller must not describe the total as verified when `trustworthy` is false.

## Persistence and rollout

Migration `0072_finance_account_semantics` adds nullable provider type/subtype plus non-null planning metadata with bounded
defaults. It performs no name-based or unbounded data backfill. Existing Plaid rows begin with
`kindSource = default` and are corrected by the next normal account synchronization, which already
loads `/accounts/get` before transaction synchronization. Manual accounts are initialized as
user-owned individual accounts.

The Drizzle schema, SQL migration, and migration journal ship together. Because the independently
published `0072_texting` migration reached `main` first with a later Drizzle timestamp,
`0073_finance_account_semantics_recovery` idempotently applies the same transition after that live
cursor. Both published `0072` files and their journal entries remain unchanged, and an integration
test covers the texting-first upgrade path. No existing migration is
rewritten.

## Mutation and audit behavior

The existing Finance account update mutation accepts kind, planning inclusion, ownership type,
and ownership share. The API validates the merged account state under the existing owned-account
transaction and records the redacted account semantics in the append-only before/after audit.
Provider synchronization records provider classification metadata but never overwrites a user kind
or planning choice.

## Error and degraded behavior

- Unsupported or malformed Plaid account types fail connector parsing as invalid provider data.
- An invalid ownership combination returns `invalid_request` without mutation.
- Stale or blocked accounts remain visible with their existing synchronization state.
- Possible duplicates and unknown ownership reduce trust but do not block unrelated account reads.
- A filter with no matches returns an empty item list and zero totals.

## Testing

Tests will prove:

1. Plaid parses and returns type/subtype and rejects an unsupported type.
2. Provider projection maps depository, investment, brokerage, credit, loan, and other correctly.
3. A user kind override survives a later provider refresh.
4. The migration preserves existing rows and initializes safe metadata defaults.
5. Account updates enforce ownership invariants and emit audited before/after semantics.
6. Account listing filters, totals, exclusions, unresolved ownership, and duplicate warnings are
   correct.
7. Wealth reporting subtracts liabilities, applies joint ownership, excludes opted-out accounts,
   and marks unresolved semantics untrustworthy.
8. The typed client and MCP expose the filters and structured result without adding business logic.

## Non-goals

- Merging duplicate accounts or transactions.
- Importing investment holdings or investment transaction history.
- Creating custom categories.
- Retirement projections or personalized setup questions.
- Changing provider credentials, account-connection authorization, or Finance mutation policy.
