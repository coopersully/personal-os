# Automatic personal Venmo access

- Research date: 2026-09-13
- Status: Plaid feasibility candidate; wallet coverage and production access unverified

## Decision and value

Test the existing Plaid connection before considering a new connector. Public evidence supports a
credible candidate, not a conclusion that automatic personal wallet access is straightforward.
Do not make Venmo a Finance MVP dependency until the evidence below passes. User uploads, manually
maintained forwarding rules, balance entry, credential scraping and undocumented APIs are outside
this Venmo feature's agreed connect-and-run experience.

The useful outcome is individual incoming/outgoing payments with enough context to distinguish
reimbursements, purchases and other activity. A bank cash-out alone cannot explain its constituent
payments. Even a complete wallet ledger may not uniquely assign a cash-out to payments because the
balance is fungible; reconcile wallet and bank transfers separately from reimbursement allocation.
Avoid counting a reimbursement again when the wallet balance reaches the bank.

## Evidence

| Path | Observed evidence | Assessment |
| --- | --- | --- |
| Existing Plaid | [Official coverage CSV](https://plaid.com/documents/us_institution_coverage.csv), generated 2026-08-12T23:45:49.325Z, lists `ins_132083`, `Venmo - Personal`, US, with `transactions=1`, `balance=1`, `liabilities=1`, `auth=0` | Promising reuse of our existing provider. Institution-level coverage does not establish wallet versus credit-card account coverage or available payment details. |
| Live Plaid discovery | [Coverage documentation](https://plaid.com/docs/institutions/) says its table is not real time and directs clients to the API/dashboard; [Institutions API](https://plaid.com/docs/api/institutions/) supports product-filtered discovery | Check current production entitlement and Transactions coverage before a consented Link test. No authenticated provider read was performed in this research. |
| Venmo/PayPal APIs | [Venmo checkout](https://developer.paypal.com/venmo/) accepts merchant payments; [API catalog](https://developer.paypal.com/api/rest/current-resources/) describes Transaction Search for PayPal accounts and Payouts to recipients | Neither establishes general personal Venmo wallet history access. |
| Legacy Venmo APIs | Search-indexed developer/webhook pages describe retired APIs; opening [the old webhook URL](https://venmo.com/docs/webhooks) on the research date redirects to business profiles | Old examples are not an available onboarding contract for new nohmi users. |
| Receipt-based access | [Copilot's own FAQ](https://help.copilot.money/en/articles/3971255-venmo-integration-faq) describes email forwarding and initial balance entry; separately it documents Plaid's `Venmo - Personal` path for credit cards | Demonstrates useful automated receipt ingestion, but its setup does not meet our requirement. It does not prove Plaid lacks wallet coverage either. |
| Statements | [Venmo history help](https://help.venmo.com/cs/articles/transaction-history-vhel281) documents personal statement downloads | Excluded user-upload path; no Venmo import implementation. |

Automatic use of receipts already available through a consented nohmi Mail connection could later
enrich Finance evidence. It is not equivalent to connecting Venmo, does not establish complete
history or balance, and must not be silently substituted for the requested integration.

## Bounded proof before implementation

1. Query live production institution metadata for Venmo with Transactions support using nohmi's
   existing provider credentials. Capture only public institution identity, product coverage,
   environment, timestamp and redacted outcome. Sandbox coverage is insufficient.
2. With user consent, connect a personal wallet through normal Plaid Link. Confirm actual account
   types; a successful credit-card connection does not pass the wallet requirement.
3. Compare returned activity against a known small set of wallet payments and a bank cash-out.
   Inspect stable IDs, date, direction, amount, status, counterparty and memo availability, fees,
   reversals, history range and balance. Missing memos are acceptable only if the remaining evidence
   demonstrably reduces ambiguity without inventing allocations.
4. Observe subsequent activity arriving without another user step. Establish refresh latency,
   duplicate/update/removal behavior, reconnect frequency, revocation, provider failures and cost.
   A single successful initial read is insufficient proof of ongoing access.
5. Verify the deployed HTTPS path and durable cursor/recovery behavior under the existing
   [connector reliability contract](connector-reliability.md). Document freshness and repair in
   the account UI; reconnect cannot be disguised as current data.

Go only when the wallet data improves reconciliation and clarification effort over bank activity
alone, without routine user intervention. If access is card-only, transfer-only, or requires an
unsupported mechanism, defer the Venmo feature. Occasional provider-required reauthorization must
be disclosed; its acceptable frequency remains a product decision.

The current Plaid transaction projection retains name/merchant, amount/date, category and
pending/posted IDs, but has no explicit counterparty or memo fields. If the provider supplies
useful details, preserve them through connector, storage, Finance evidence and API/MCP contracts;
enabling an institution in Link alone would not deliver the intended outcome.
