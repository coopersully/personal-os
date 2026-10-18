import type { FinanceSpendingScope } from "@personal-os/domain";
import { expect, it } from "vitest";
import type { SpendingEvidenceInput } from "./spending-contributions.js";
import { spendingQualificationsForScope } from "./spending-qualification-scope.js";

const scope: FinanceSpendingScope = {
  from: "2026-03-01",
  through: "2026-03-31",
  timezone: "America/New_York",
  accountIds: ["selected"],
  categoryIds: null,
  basis: "personal_cost",
  includePending: true,
  subtractRefunds: true,
};
const account = (id: string): SpendingEvidenceInput["accounts"][number] => ({
  id,
  userId: "owner",
  currencyCode: "USD",
  kind: "cash",
  includeInPlanning: true,
  ownershipType: "individual",
  ownershipShareBps: 10000,
});
const transaction = (
  id: string,
  accountId: string,
  transactionDate = "2026-03-10",
): SpendingEvidenceInput["transactions"][number] => ({
  id,
  accountId,
  transactionDate,
  userId: "owner",
  currencyCode: "USD",
  amount: 100,
  category: null,
  categoryId: null,
  direction: "expense",
  providerDirection: null,
  pending: false,
  pendingTransactionId: null,
  providerTransactionId: null,
  reconciliationStatus: "not_applicable",
  transferGroupId: null,
});
const input = (): SpendingEvidenceInput => ({
  userId: "owner",
  asOf: "2026-03-25T00:00:00Z",
  coverage: "unknown",
  accounts: [account("selected"), account("outside")],
  transactions: [transaction("purchase", "selected"), transaction("other", "outside")],
  allocations: [],
  reimbursements: [],
  matches: [],
  relationships: [],
});
it("attributes known account/transaction uncertainty but fails closed for unmapped sources", () => {
  const qualifications = [
    { code: "unsupported_currency" as const, sourceIds: ["purchase", "other", "unmapped"] },
    { code: "ownership_unknown" as const, sourceIds: ["outside"] },
  ];
  expect(spendingQualificationsForScope(input(), scope, qualifications)).toEqual([
    { code: "unsupported_currency", sourceIds: ["purchase", "unmapped"] },
  ]);
  expect(qualifications[0]?.sourceIds).toEqual(["purchase", "other", "unmapped"]);
  expect(
    spendingQualificationsForScope(input(), scope, [{ code: "stale_evidence", sourceIds: [] }]),
  ).toEqual([{ code: "stale_evidence", sourceIds: [] }]);
});
it("retains pending-replacement counterparts outside the selected account/date", () => {
  const evidence = input();
  evidence.transactions[0] = {
    ...transaction("purchase", "selected"),
    pendingTransactionId: "provider-pending",
  };
  evidence.transactions[1] = {
    ...transaction("other", "outside", "2026-02-28"),
    providerTransactionId: "provider-pending",
    pending: true,
  };
  expect(
    spendingQualificationsForScope(evidence, scope, [
      { code: "unsupported_currency", sourceIds: ["other"] },
    ]),
  ).toHaveLength(1);
});
it("retains transfer-group event uncertainty and ignores unrelated transfer groups", () => {
  const evidence = input();
  evidence.transactions[0] = {
    ...transaction("purchase", "selected"),
    transferGroupId: "relevant-transfer",
    direction: "transfer",
    reconciliationStatus: "matched",
  };
  evidence.transactions[1] = {
    ...transaction("other", "outside"),
    transferGroupId: "unrelated-transfer",
    direction: "transfer",
    reconciliationStatus: "matched",
  };
  expect(
    spendingQualificationsForScope(evidence, scope, [
      {
        code: "transfer_evidence_incomplete",
        sourceIds: ["relevant-transfer", "unrelated-transfer"],
      },
    ]),
  ).toEqual([{ code: "transfer_evidence_incomplete", sourceIds: ["relevant-transfer"] }]);
});
it("does not attribute a standalone excluded pending transaction", () => {
  const evidence = input();
  evidence.transactions[0] = { ...transaction("purchase", "selected"), pending: true };
  expect(
    spendingQualificationsForScope(evidence, { ...scope, includePending: false }, [
      { code: "unsupported_currency", sourceIds: ["purchase"] },
    ]),
  ).toEqual([]);
});
it("retains reimbursement claim and credit uncertainty connected to a selected allocation", () => {
  const evidence = input();
  evidence.allocations = [
    {
      id: "allocation",
      transactionId: "purchase",
      categoryId: null,
      amount: 100,
      state: "active",
      treatment: "reimbursable",
    },
  ];
  evidence.reimbursements = [
    {
      id: "claim",
      allocationId: "allocation",
      expectedAmount: 50,
      receivedAmount: 0,
      status: "expected",
    },
  ];
  evidence.matches = [{ reimbursementId: "claim", creditTransactionId: "other", amount: 50 }];
  expect(
    spendingQualificationsForScope(evidence, scope, [
      { code: "reimbursement_allocation_unresolved", sourceIds: ["claim"] },
      { code: "unsupported_currency", sourceIds: ["other"] },
    ]),
  ).toEqual([
    { code: "reimbursement_allocation_unresolved", sourceIds: ["claim"] },
    { code: "unsupported_currency", sourceIds: ["other"] },
  ]);
});

it("does not reconnect a superseded relationship to unrelated uncertainty", () => {
  const evidence = input();
  evidence.transactions.push(transaction("third", "outside"));
  const relation = {
    id: "old",
    eventId: "event",
    eventUserId: "owner",
    userId: "owner",
    relationship: "refund" as const,
    transactionIds: ["purchase", "other"],
    createdAt: "2026-03-01T00:00:00Z",
    provenance: { actorType: "user" as const },
    provenanceValidated: true,
  };
  evidence.relationships = [
    relation,
    {
      ...relation,
      id: "new",
      transactionIds: ["other", "third"],
      createdAt: "2026-03-02T00:00:00Z",
    },
  ];
  expect(
    spendingQualificationsForScope(evidence, scope, [
      { code: "unsupported_currency", sourceIds: ["other"] },
    ]),
  ).toEqual([]);
});
