# Mobile Finance implementation

Approved by Cooper on November 7, 2026. Tracking: COO-210 — Mobile Finance.
Spec: ../specs/2026-11-07-mobile-finance-design.md.

## Constraints
Preserve native Apple navigation; consume typed owner-scoped API queries. No synthetic production balances, inferred currency conversion, client accounting policy, duplicate decision summary, automatic approvals, or personal-record test mutations. Reuse mobile spacing and entity/icon conventions. Discrete feedback uses Sonner.

## Tasks
1. Add presentation helpers with boundary tests (unknown money, currencies, date-only periods), five native destinations and shared Finance primitives.
2. Implement live Overview, Spending, Accounts and paginated transaction/account drill-down. Read errors offer retry; do not render missing data as zero. Scoped spending references must retain server context.
3. Implement Plan subviews and Assistant using canonical read contracts; follow with safe editors and existing workflow integration. Never collapse save and budget approval.
4. Add interaction coverage, run mobile typecheck and focused tests, inspect simulator and capture screenshots. Conduct independent whole-branch review. Record remaining parity/release gates explicitly.

## Interfaces and verification
Queries use session owner + Finance scope; pages compose small domain-owned modules. Money is formatted without changing units; spending cents convert only at display. Existing native shell owns tab styling and transitions.
Run `pnpm exec vitest run apps/mobile/src/features/finances` and `pnpm --filter @personal-os/mobile typecheck` throughout. Full frozen verification is required before merge/release.

## Review focus
Owner changes, missing and mixed currencies, date boundaries and user timezone, pending/source qualifications, pagination, stale financial approvals, inaccessible controls and uncertain writes.
