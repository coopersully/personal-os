// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { FinanceAccount } from "@personal-os/domain";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FinanceAccountsView } from "./accounts-view";

vi.stubGlobal(
  "IntersectionObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
const account = (id: string, overrides: Partial<FinanceAccount> = {}): FinanceAccount => ({
  id,
  name: id,
  institution: "Example Bank",
  provider: "plaid",
  providerType: "depository",
  providerSubtype: "checking",
  kind: "cash",
  kindSource: "provider",
  balance: 100,
  currencyCode: "USD",
  ownershipType: "individual",
  ownershipShare: 1,
  includeInPlanning: true,
  status: "connected",
  lastSyncedAt: new Date().toISOString(),
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  synchronization: {
    state: "current",
    failureCode: null,
    failureCount: 0,
    lastAttemptAt: null,
    lastSuccessAt: null,
    nextRetryAt: null,
    recovery: null,
    message: null,
  },
  ...overrides,
});
const accounts = [
  account("Travel card", { providerType: "credit", providerSubtype: "credit card", kind: "debt" }),
  account("Everyday checking"),
  account("Debit card", { providerSubtype: "debit card" }),
  account("Retirement", {
    providerType: "investment",
    providerSubtype: "401k",
    kind: "investment",
    institution: "Example Brokerage",
    includeInPlanning: false,
  }),
  account("Manual loan", {
    provider: "manual",
    status: "manual",
    kind: "debt",
    providerType: null,
    providerSubtype: null,
  }),
];
function Location() {
  return <output aria-label="Location">{useLocation().search}</output>;
}
function setup(initial = "/finances/accounts", ownerId = "owner-a") {
  const onEdit = vi.fn();
  const view = render(
    <MemoryRouter initialEntries={[initial]}>
      <TooltipProvider>
        <FinanceAccountsView
          accounts={accounts}
          ownerId={ownerId}
          duplicateGroups={[]}
          onEdit={onEdit}
          attentionAction={() => null}
        />
        <Location />
      </TooltipProvider>
    </MemoryRouter>,
  );
  return { ...view, onEdit };
}
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  });
});
afterEach(cleanup);
it("shows credit cards first in a carousel and exposes every account in the standard view", () => {
  const { onEdit } = setup();
  const cards = screen.getByRole("region", { name: "Cards" });
  expect(within(cards).getByText("Travel card")).toBeVisible();
  expect(within(cards).queryByText("Everyday checking")).toBeNull();
  expect(
    within(cards).getByText("Debit card", { selector: ".financial-account-card__name" }),
  ).toBeVisible();
  const options = within(cards).getByRole("button", { name: "Account options for Travel card" });
  expect(options).toHaveTextContent("Details");
  expect(options.closest('[data-slot="financial-account-card"]')).not.toBeNull();
  const table = screen.getByRole("table", { name: "Accounts" });
  expect(within(table).getByText("Retirement")).toBeVisible();
  const type = within(table).getByText("Credit card", { selector: '[data-slot="badge"]' });
  expect(type.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  expect(
    within(table).getByRole("button", { name: "Open account Travel card" }),
  ).not.toHaveTextContent("Credit card");
  fireEvent.click(within(table).getByRole("button", { name: "Open account Everyday checking" }));
  expect(onEdit).toHaveBeenCalledWith(accounts[1]);
});
it("searches across type, institution and name, and clears only this view's scope", () => {
  setup("/finances/accounts?review=open&planning=excluded");
  expect(screen.queryByRole("region", { name: "Cards" })).toBeNull();
  fireEvent.change(screen.getByRole("textbox", { name: "Search accounts" }), {
    target: { value: "nothing matches" },
  });
  expect(screen.getByText("No matching accounts")).toBeVisible();
  expect(screen.queryByRole("table", { name: "Accounts" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Table actions" })).toBeNull();
  expect(screen.queryByRole("checkbox", { name: "Select all rows on this page" })).toBeNull();
  expect(screen.queryByText("0 of 5 accounts")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Clear search and filters" }));
  expect(screen.getByLabelText("Location")).toHaveTextContent("?review=open");
  fireEvent.change(screen.getByRole("textbox", { name: "Search accounts" }), {
    target: { value: "example brokerage" },
  });
  expect(screen.getByRole("button", { name: "Open account Retirement" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Open account Travel card" })).toBeNull();
});
it("combines type, institution, connection and planning filters", () => {
  setup(
    "/finances/accounts?accountType=bank&institution=Example+Bank&accountState=connected&planning=included",
  );
  expect(screen.getByRole("button", { name: "Open account Everyday checking" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Open account Travel card" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Open account Manual loan" })).toBeNull();
});
it("lets the user choose an account type through the shared filters", async () => {
  setup();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Filters" }));
  await user.click(screen.getByRole("button", { name: "Account type: All types" }));
  await user.click(screen.getByRole("menuitemradio", { name: "Investment account" }));
  expect(screen.getByLabelText("Location")).toHaveTextContent("accountType=investment");
  await user.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.getByRole("button", { name: "Open account Retirement" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Open account Everyday checking" })).toBeNull();
});
it("saves table customization under the authenticated owner's key", async () => {
  setup();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Table actions" }));
  await user.click(screen.getByRole("menuitem", { name: "Table Options" }));
  await user.click(screen.getByRole("switch", { name: "Wrap long text" }));
  const saved = JSON.parse(
    localStorage.getItem("nohmi:data-view:finance-accounts:owner-a") ?? "{}",
  );
  expect(saved.wrap).toBe(true);
  expect(localStorage.getItem("nohmi:data-view:finance-accounts:owner-b")).toBeNull();
});

it("exposes edit and transaction commands without an overflow menu", () => {
  const { onEdit } = setup();
  const actions = screen.getByRole("group", { name: "Actions for Everyday checking" });
  fireEvent.click(within(actions).getByRole("button", { name: "Edit Everyday checking" }));
  expect(onEdit).toHaveBeenCalledExactlyOnceWith(accounts[1]);
  expect(
    within(actions).getByRole("link", { name: "Transactions for Everyday checking" }),
  ).toHaveAttribute("href", "/finances/transactions?accountId=Everyday%20checking");
});
