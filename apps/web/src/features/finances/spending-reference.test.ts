import {
  type FinanceSpendingReferenceFilter,
  financeSpendingReferenceFilterSchema,
} from "@personal-os/domain";
import { expect, it } from "vitest";
import {
  parseSpendingRecovery,
  spendingRecoveryControls,
  spendingRecoveryDestination,
} from "./spending-reference";

function filter(accountIds: string[] | null): FinanceSpendingReferenceFilter {
  return {
    query: {
      scope: {
        from: "2026-09-01",
        through: "2026-09-30",
        timezone: "America/Chicago",
        accountIds,
        categoryIds: [null, "food"],
        basis: "full_outflow",
        includePending: false,
        subtractRefunds: false,
      },
      grouping: "buckets",
      includeUncategorized: false,
    },
    referenceRevision: "a".repeat(64),
    groupId: "bucket:food",
    from: "2026-09-08",
    through: "2026-09-09",
  };
}
it("roundtrips the bounded complete reference including null/empty selections and selected subset", () => {
  for (const accounts of [null, [], ["account"]]) {
    const value = filter(accounts);
    const destination = spendingRecoveryDestination(value);
    expect(destination).not.toBeNull();
    const params = new URL(destination ?? "", "https://nohmi.example").searchParams;
    const recovered = parseSpendingRecovery(params.get("recoverSpending"));
    expect(recovered).toEqual({ state: "valid", filter: value });
    expect(
      financeSpendingReferenceFilterSchema.parse(JSON.parse(params.get("recoverSpending") ?? "{}")),
    ).toEqual(value);
    const controls = spendingRecoveryControls(params, value);
    expect(controls.get("accounts")).toBe(accounts === null ? "all" : accounts.join(","));
    expect(controls.get("timezone")).toBe("America/Chicago");
    expect(controls.get("from")).toBe("2026-09-01");
    expect(controls.get("through")).toBe("2026-09-30");
    expect(controls.get("categories")).toBe("uncategorized,food");
    expect(params.get("recoverSpending")).not.toContain("contributionIds");
  }
});
it("fails closed for invalid or oversized references", () => {
  expect(parseSpendingRecovery("{")).toEqual({ state: "invalid" });
  expect(parseSpendingRecovery("x".repeat(16001))).toEqual({ state: "invalid" });
  expect(spendingRecoveryDestination({ ...filter(null), referenceRevision: "invalid" })).toBeNull();
  expect(
    spendingRecoveryDestination({
      ...filter(null),
      query: {
        ...filter(null).query,
        scope: {
          ...filter(null).query.scope,
          accountIds: Array.from({ length: 1000 }, (_, index) => `long-account-reference-${index}`),
        },
      },
    }),
  ).toBeNull();
});
it("preserves null versus explicitly empty category selections", () => {
  const value = filter(null);
  value.query.scope.categoryIds = null;
  expect(spendingRecoveryControls(new URLSearchParams(), value).has("categories")).toBe(false);
  value.query.scope.categoryIds = [];
  expect(spendingRecoveryControls(new URLSearchParams(), value).get("categories")).toBe("");
});
it("distinguishes no recovery from well-formed JSON with an unauthorized or incomplete descriptor", () => {
  expect(parseSpendingRecovery(null)).toEqual({ state: "absent" });
  for (const value of [{}, { ...filter(null), groupId: 42 }, { ...filter(null), query: {} }]) {
    expect(parseSpendingRecovery(JSON.stringify(value))).toEqual({ state: "invalid" });
  }
});
it("restores enabled accounting flags without mutating unrelated controls or the original URL", () => {
  const value = filter([]);
  value.query.scope.includePending = true;
  value.query.scope.subtractRefunds = true;
  value.query.includeUncategorized = true;
  const original = new URLSearchParams("view=list&categories=old&pending=0");
  const next = spendingRecoveryControls(original, value);
  expect(next.get("pending")).toBe("1");
  expect(next.get("refunds")).toBe("1");
  expect(next.get("uncategorized")).toBe("1");
  expect(next.get("view")).toBe("list");
  expect(original.toString()).toBe("view=list&categories=old&pending=0");
});
