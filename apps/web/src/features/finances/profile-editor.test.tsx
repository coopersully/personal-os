// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FinanceProfileEditor } from "./profile-editor.js";

const api = vi.hoisted(() => ({ getFinancialProfile: vi.fn(), updateFinancialProfile: vi.fn() }));
vi.mock("../../api.js", () => ({
  api,
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : "Unknown error"),
}));
const envelope = (data: unknown) => ({
  data,
  outcome: "completed",
  communication: { headline: "Loaded", optionalDetails: [], requiredDisclosures: [] },
});
const profile = {
  id: "profile-1",
  userId: "user-1",
  version: 4,
  createdAt: "2026-09-03T12:00:00.000Z",
  debts: [
    {
      accountId: "account-1",
      balance: 500,
      interestRate: null,
      minimumMonthlyPayment: 20,
      name: "Example loan",
    },
  ],
  dependents: null,
  householdSize: 2,
  expectedMonthlyTakeHome: null,
  incomeStability: "variable",
  jurisdiction: "US-NY",
  liquidReserves: 5000,
  insurance: [
    {
      name: "Example health plan",
      kind: "health",
      status: "active",
      annualPremium: null,
      coverageAmount: null,
    },
  ],
  preferences: {
    bufferTarget: 200,
    debtPriority: "avalanche",
    emergencyReserveMonths: 6,
    notes: ["Keep flexible spending"],
  },
  provenance: {},
};
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <FinanceProfileEditor />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  api.getFinancialProfile.mockResolvedValue(envelope(profile));
  api.updateFinancialProfile.mockResolvedValue(envelope({ ...profile, version: 5 }));
});
afterEach(cleanup);

describe("Canonical Finance profile editor", () => {
  it("preserves the exact boundaries and contents of agent-authored multiline notes when other fields change", async () => {
    const notes = [
      "Keep six months of emergency cash.\nReview before withdrawing.",
      "Support family commitments.",
    ];
    api.getFinancialProfile.mockResolvedValue(
      envelope({ ...profile, preferences: { ...profile.preferences, notes } }),
    );
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Edit financial profile" }));
    fireEvent.change(screen.getByLabelText("Household size"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Reserve target (months)"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Save financial profile" }));
    await waitFor(() =>
      expect(api.updateFinancialProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          changes: {
            householdSize: 3,
            preferences: { ...profile.preferences, emergencyReserveMonths: 9, notes },
          },
          expectedVersion: 4,
        }),
      ),
    );
  });
  it.each([
    "prior failed key",
    "failed envelope",
  ])("keeps edited profile values and renews its retry key after a confirmed %s", async (failure) => {
    if (failure === "prior failed key")
      api.updateFinancialProfile.mockRejectedValueOnce(
        new Error("That Finance mutation previously failed; use a new idempotency key to retry."),
      );
    else
      api.updateFinancialProfile.mockResolvedValueOnce({ ...envelope(profile), outcome: "failed" });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Edit financial profile" }));
    fireEvent.change(screen.getByLabelText("Household size"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save financial profile" }));
    await screen.findByText("Financial profile was not saved");
    expect(screen.getByLabelText("Household size")).toHaveValue(3);
    fireEvent.click(screen.getByRole("button", { name: "Save financial profile" }));
    await waitFor(() => expect(api.updateFinancialProfile).toHaveBeenCalledTimes(2));
    const first = api.updateFinancialProfile.mock.calls[0]?.[0];
    const second = api.updateFinancialProfile.mock.calls[1]?.[0];
    expect(second).toEqual({ ...first, idempotencyKey: expect.any(String) });
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });
  it("keeps unknown fields blank and only sends the changed field with its exact version", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Edit financial profile" }));
    expect(screen.getByLabelText("Expected monthly take-home (USD)")).toHaveValue(null);
    expect(screen.getByLabelText("Dependents")).toHaveValue(null);
    fireEvent.change(screen.getByLabelText("Expected monthly take-home (USD)"), {
      target: { value: "3500" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save financial profile" }));
    await waitFor(() =>
      expect(api.updateFinancialProfile).toHaveBeenCalledWith({
        changes: { expectedMonthlyTakeHome: 3500 },
        expectedVersion: 4,
        idempotencyKey: expect.any(String),
      }),
    );
  });
  it("preserves the remaining preference fields when editing one preference", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Edit financial profile" }));
    fireEvent.change(screen.getByLabelText("Reserve target (months)"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Save financial profile" }));
    await waitFor(() =>
      expect(api.updateFinancialProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          changes: { preferences: { ...profile.preferences, emergencyReserveMonths: 9 } },
          expectedVersion: 4,
        }),
      ),
    );
  });
  it("retains the draft and original revision on conflict", async () => {
    api.updateFinancialProfile.mockRejectedValue(new Error("Profile is at version 5; reload it."));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Edit financial profile" }));
    fireEvent.change(screen.getByLabelText("Household size"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save financial profile" }));
    expect(await screen.findByText(/Profile is at version 5/)).toBeInTheDocument();
    expect(screen.getByLabelText("Household size")).toHaveValue(3);
    fireEvent.click(screen.getByRole("button", { name: "Save financial profile" }));
    await waitFor(() => expect(api.updateFinancialProfile).toHaveBeenCalledTimes(2));
    expect(api.updateFinancialProfile.mock.calls[1]?.[0]).toEqual(
      api.updateFinancialProfile.mock.calls[0]?.[0],
    );
  });
  it("creates the first canonical profile at version zero without filling unknown amounts", async () => {
    api.getFinancialProfile.mockResolvedValue(envelope(null));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Create financial profile" }));
    fireEvent.change(screen.getByLabelText("Jurisdiction"), { target: { value: "US-NY" } });
    fireEvent.click(screen.getByRole("button", { name: "Save financial profile" }));
    await waitFor(() =>
      expect(api.updateFinancialProfile).toHaveBeenCalledWith({
        expectedVersion: 0,
        changes: { jurisdiction: "US-NY" },
        idempotencyKey: expect.any(String),
      }),
    );
  });
  it("renders the unknown and unlinked profile alternatives without inventing detail", async () => {
    api.getFinancialProfile.mockResolvedValue(
      envelope({
        ...profile,
        jurisdiction: null,
        householdSize: null,
        dependents: 1,
        debts: [{ ...profile.debts[0], accountId: null, interestRate: 4.5 }],
        preferences: {
          ...profile.preferences,
          debtPriority: null,
          emergencyReserveMonths: null,
          notes: [],
        },
      }),
    );
    mount();
    expect(await screen.findAllByText("Not recorded")).toHaveLength(2);
    expect(screen.getByText(/Unknown size · 1 dependents/)).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Recorded debts, insurance, and preferences" }),
    );
    expect(await screen.findByText(/4.5% interest/)).toBeVisible();
    expect(screen.getByText(/Debt priority not recorded/)).toBeVisible();
    expect(screen.queryByRole("link", { name: "Inspect linked account" })).not.toBeInTheDocument();
  });
  it("saves select and multiline preference changes and exposes pending state", async () => {
    let release: ((value: unknown) => void) | undefined;
    api.updateFinancialProfile.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Edit financial profile" }));
    fireEvent.change(screen.getByLabelText("Income stability"), { target: { value: "stable" } });
    fireEvent.change(screen.getByLabelText("Planning notes"), {
      target: { value: " First note \n\n Second note " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save financial profile" }));
    expect(await screen.findByText("Saving financial profile…")).toBeVisible();
    release?.(envelope({ ...profile, version: 5 }));
    await waitFor(() => expect(api.updateFinancialProfile).toHaveBeenCalled());
  });
});
