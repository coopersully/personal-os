// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { FinanceMaintenancePayload, FinanceToolResult } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { SetupMaintenance } from "./setup-maintenance.js";

const api = vi.hoisted(() => ({ maintainFinances: vi.fn() }));
vi.mock("../../api.js", () => ({ api }));
const id = "11111111-1111-4111-8111-111111111111";
const start = {
  tool: "maintain_finances",
  arguments: { operation: "start" },
  reason: "Check evidence",
};
function mount(nextAction: ComponentProps<typeof SetupMaintenance>["nextAction"] = start) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SetupMaintenance nextAction={nextAction} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
function response(data: FinanceMaintenancePayload): FinanceToolResult<FinanceMaintenancePayload> {
  return {
    data,
    changes: [],
    communication: {
      headline: "Evidence checked",
      optionalDetails: [],
      requiredDisclosures: [{ importance: "important", message: "One account is still stale." }],
    },
    outcome: "completed",
    remainingWork: { count: 0, categories: [] },
    schemaVersion: 1,
  };
}
function run(
  status: "awaiting_approval" | "completed_with_questions" | "awaiting_agent_challenge",
): FinanceMaintenancePayload {
  return {
    challengeId: null,
    nextAction: null,
    recovery: null,
    run: {
      id,
      userId: id,
      domain: "finances",
      scope: { type: "all_outstanding" },
      rulebookVersion: "1",
      sourceSnapshot: null,
      checkpoint: null,
      lastSafeError: null,
      settledResult: null,
      createdAt: "2026-09-03T12:00:00Z",
      updatedAt: "2026-09-03T12:00:00Z",
      status,
      leaseExpiresAt: null,
      retryAt: null,
    },
  };
}
beforeEach(() => vi.resetAllMocks());
it.each([
  { tool: "get_finance_status", arguments: {}, reason: "Inspect status" },
  { tool: "maintain_finances", arguments: { operation: "resume" }, reason: "Missing run identity" },
])("does not guess a maintenance input from $reason", (nextAction) => {
  mount(nextAction);
  expect(screen.getByRole("button", { name: "Start initial maintenance" })).toBeDisabled();
  expect(api.maintainFinances).not.toHaveBeenCalled();
});
it.each([
  "awaiting_approval",
  "completed_with_questions",
] as const)("routes %s to Review and resumes the same run", async (status) => {
  api.maintainFinances.mockResolvedValue(response(run(status)));
  const client = mount();
  client.setQueryData(["finance-setup"], {});
  client.setQueryData(["mail"], {});
  fireEvent.click(screen.getByRole("button", { name: "Start initial maintenance" }));
  expect(await screen.findByRole("link", { name: "Answer in Review" })).toHaveAttribute(
    "href",
    "/finances?review=open",
  );
  expect(screen.getByText("One account is still stale.")).toBeVisible();
  expect(client.getQueryState(["finance-setup"])?.isInvalidated).toBe(true);
  expect(client.getQueryState(["mail"])?.isInvalidated).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Check maintenance progress" }));
  await waitFor(() =>
    expect(api.maintainFinances).toHaveBeenLastCalledWith({ operation: "resume", runId: id }),
  );
});
it("shows the ledger challenge reason and connected-agent route", async () => {
  api.maintainFinances.mockResolvedValue(
    response({
      ...run("awaiting_agent_challenge"),
      nextAction: {
        tool: "get_finance_ledger_challenge",
        arguments: { challengeId: id },
        reason: "An independent agent must challenge these classifications.",
      },
    }),
  );
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Start initial maintenance" }));
  expect(await screen.findByRole("heading", { name: "Ledger challenge required" })).toBeVisible();
  expect(
    screen.getByText("An independent agent must challenge these classifications."),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "Connected agents" })).toHaveAttribute(
    "href",
    "/settings?section=agent-connections",
  );
  expect(screen.queryByRole("link", { name: "Answer in Review" })).not.toBeInTheDocument();
});
it("keeps recovery evidence visible when there is no adopted run", async () => {
  api.maintainFinances.mockResolvedValue(
    response({
      run: null,
      challengeId: null,
      nextAction: null,
      recovery: {
        legacyRunId: id,
        state: "blocked",
        originalScope: {},
        originalStage: "categorization",
        throughDate: null,
        reason: "The original account must be reconnected.",
      },
    }),
  );
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Start initial maintenance" }));
  expect(await screen.findByRole("heading", { name: "Maintenance recovery" })).toBeVisible();
  expect(screen.getByText("The original account must be reconnected.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Start initial maintenance" })).toBeEnabled();
});
it("prevents duplicate starts and preserves the start action after failure", async () => {
  let reject: (error: Error) => void = () => {};
  api.maintainFinances.mockImplementationOnce(
    () =>
      new Promise((_resolve, onReject) => {
        reject = onReject;
      }),
  );
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Start initial maintenance" }));
  expect(await screen.findByRole("button", { name: "Checking maintenance…" })).toBeDisabled();
  await act(async () => reject(new Error("Connection interrupted")));
  expect(await screen.findByRole("button", { name: "Start initial maintenance" })).toBeEnabled();
  expect(screen.getByRole("status")).toHaveTextContent(/Couldn’t/);
  expect(api.maintainFinances).toHaveBeenCalledTimes(1);
});
