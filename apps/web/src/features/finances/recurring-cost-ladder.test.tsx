// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { FinanceRecurringObligation } from "@personal-os/domain";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RecurringCostLadder } from "./recurring-cost-ladder";

const fixture = (
  changes: Partial<FinanceRecurringObligation> = {},
): FinanceRecurringObligation => ({
  id: "bill-1",
  accountId: "account-1",
  displayName: "Music",
  merchant: "Same merchant",
  kind: "subscription",
  cadence: "monthly",
  status: "active",
  source: "user",
  confidence: 1,
  expectedAmount: 19.99,
  nextExpectedDate: "2026-11-01",
  lastObservedDate: "2026-10-01",
  ...changes,
});
function show(
  obligations: FinanceRecurringObligation[],
  accounts = [{ id: "account-1", name: "Checking", currencyCode: "USD" }],
) {
  return render(
    <MemoryRouter>
      <RecurringCostLadder obligations={obligations} accounts={accounts} />
    </MemoryRouter>,
  );
}

it("preserves payment evidence and does not infer fixedness from a user supplied record", () => {
  show([fixture()]);
  const row = within(screen.getByRole("listitem", { name: "Music" }));
  expect(row.getByText("$19.99")).toBeVisible();
  expect(row.getByText(/User supplied · Monthly · Checking/)).toBeVisible();
  expect(row.getAllByText("Unavailable")).toHaveLength(2);
  expect(row.getByText("Fixed or variable amount not established")).toBeVisible();
  fireEvent.click(row.getByText("Calculation and source details"));
  expect(row.getByText(/Next expected: 2026-11-01 · Last observed: 2026-10-01/)).toBeVisible();
  expect(row.getByRole("link", { name: "View source account activity for Music" })).toHaveAttribute(
    "href",
    "/finances/transactions?accountId=account-1",
  );
  expect(row.getByText("Record: bill-1")).toBeInTheDocument();
  expect(row.queryByRole("button")).not.toBeInTheDocument();
});

it("separates review, inferred and inactive records without merging matching merchants", () => {
  show([
    fixture(),
    fixture({ id: "bill-2", displayName: "Video", source: "inferred" }),
    fixture({ id: "bill-3", displayName: "Review", status: "needs_review" }),
    fixture({ id: "bill-4", displayName: "Paused", status: "paused" }),
    fixture({ id: "bill-5", displayName: "Ended", status: "cancelled" }),
    fixture({ id: "save", displayName: "Emergency savings", kind: "savings" }),
  ]);
  expect(
    within(screen.getByRole("region", { name: "Active recurring costs" })).getAllByRole("listitem"),
  ).toHaveLength(1);
  expect(
    within(screen.getByRole("region", { name: "Inferred recurring costs" })).getByText("Video"),
  ).toBeVisible();
  expect(
    within(screen.getByRole("region", { name: "Needs review recurring costs" })).getByText(
      "Review",
    ),
  ).toBeVisible();
  expect(
    within(screen.getByRole("region", { name: "Inactive recurring costs" })).getAllByRole(
      "listitem",
    ),
  ).toHaveLength(2);
  expect(screen.queryByText("Emergency savings")).not.toBeInTheDocument();
  expect(screen.getByText("Savings contributions excluded.")).toBeVisible();
});

it("never supplies a currency fallback or rounds subcent input into supported money", () => {
  show([
    fixture({ accountId: null, expectedAmount: 0 }),
    fixture({ id: "subcent", displayName: "Subcent", expectedAmount: 1.234 }),
  ]);
  expect(screen.getByText("0 · currency unavailable")).toBeVisible();
  expect(screen.getByText(/Account currency unavailable/)).toBeVisible();
  expect(screen.getByText("$1.234")).toBeVisible();
  expect(screen.getByText(/Amount is not exact supported cents/)).toBeVisible();
});

it.each([
  "JPY",
  "KWD",
  "ZZZ",
])("keeps unsupported currency %s out of equivalent amounts", (currencyCode) => {
  show([fixture()], [{ id: "account-1", name: "Foreign", currencyCode }]);
  expect(screen.getAllByText("Unavailable")).toHaveLength(2);
  expect(
    screen.getByText(
      currencyCode === "ZZZ" ? /Currency not recognized/ : /Currency minor units unsupported/,
    ),
  ).toBeVisible();
});

it("shows an empty comparison when only savings exist", () => {
  show([fixture({ kind: "savings" })]);
  expect(screen.getByText("No bills or subscriptions to compare")).toBeVisible();
  expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
});

it("passes the original record to parent-owned accessible actions", () => {
  const obligation = fixture();
  const renderActions = vi.fn((item: FinanceRecurringObligation) => (
    <button type="button">Pause {item.displayName}</button>
  ));
  render(
    <MemoryRouter>
      <RecurringCostLadder obligations={[obligation]} accounts={[]} renderActions={renderActions} />
    </MemoryRouter>,
  );
  expect(renderActions).toHaveBeenCalledWith(obligation);
  expect(renderActions.mock.calls[0]?.[0]).toBe(obligation);
  expect(
    within(screen.getByRole("listitem", { name: "Music" })).getByRole("button", {
      name: "Pause Music",
    }),
  ).toBeVisible();
});

const ownerId = "00000000-0000-4000-8000-000000000001";
function evidenced(changes: Partial<FinanceRecurringObligation> = {}): FinanceRecurringObligation {
  const record = fixture({
    id: "00000000-0000-4000-8000-000000000002",
    accountId: null,
    revision: 2,
    cadence: "weekly",
    expectedAmount: 1.01,
    ...changes,
  });
  return {
    ...record,
    planningEvidence: {
      evidenceId: "00000000-0000-4000-8000-000000000004",
      kind: "obligation",
      ownerUserId: ownerId,
      actor: { type: "user", userId: ownerId },
      provenance: "explicit_user",
      sourceId: record.id,
      sourceRevision: 2,
      expectedAmountCents: 101,
      cadence: "weekly",
      accountId: null,
      fixedness: "fixed",
      currencyCode: "USD",
      asOf: "2026-10-01",
      recordedAt: "2026-10-01T00:00:00Z",
    },
  };
}
function qualified(items: FinanceRecurringObligation[]) {
  return render(
    <MemoryRouter>
      <RecurringCostLadder
        obligations={items}
        accounts={[]}
        evidenceContext={{ ownerUserId: ownerId, today: "2026-10-18" }}
      />
    </MemoryRouter>,
  );
}
it("normalizes only current explicit fixed evidence, with rounded monthly labels and subset coverage", () => {
  qualified([evidenced(), fixture({ id: "missing", displayName: "Missing" })]);
  const row = within(screen.getByRole("listitem", { name: "Music" }));
  expect(row.getByText("$52.52")).not.toBeVisible();
  fireEvent.click(row.getByText("Calculation and source details"));
  expect(row.getByText("$52.52")).toBeVisible();
  expect(row.getByText("$4.38 (rounded)")).toBeVisible();
  expect(row.getByText(/52 payments per year/)).toBeVisible();
  expect(screen.getByText(/1 of 2 records included; 1 excluded/)).toBeVisible();
});
it.each(["stale", "variable", "foreign", "future"])("excludes %s statements honestly", (kind) => {
  const record = evidenced();
  const evidence = record.planningEvidence;
  if (!evidence) throw new Error("Fixture evidence absent");
  if (kind === "stale") evidence.sourceRevision = 1;
  if (kind === "variable") evidence.fixedness = "variable";
  if (kind === "foreign") evidence.ownerUserId = "00000000-0000-4000-8000-000000000099";
  if (kind === "future") evidence.asOf = "2026-10-19";
  qualified([record]);
  expect(screen.getAllByText("Unavailable")).toHaveLength(2);
  expect(screen.getByText(/0 of 1 records included; 1 excluded/)).toBeVisible();
});
it("keeps currencies separate and review evidence in the suspected subset", () => {
  const euro = evidenced({
    id: "00000000-0000-4000-8000-000000000005",
    displayName: "Euro",
    status: "needs_review",
  });
  if (euro.planningEvidence) euro.planningEvidence.currencyCode = "EUR";
  qualified([evidenced(), euro]);
  const subset = within(screen.getByRole("region", { name: "Known recurring cost subset" }));
  expect(subset.getByText("Confirmed USD annual subset")).not.toBeVisible();
  fireEvent.click(subset.getByText("Annual equivalents (USD)"));
  fireEvent.click(subset.getByText("Annual equivalents (EUR)"));
  expect(subset.getByText("Confirmed USD annual subset")).toBeVisible();
  expect(subset.getByText("Suspected EUR annual subset")).toBeVisible();
  expect(subset.getByText("$52.52")).toBeVisible();
  expect(subset.getByText("€52.52")).toBeVisible();
});
