// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { FinanceHostSettings } from "./host-settings.js";

const mocks = vi.hoisted(() => ({
  listAutomationHostSchedules: vi.fn(),
  listAutomationHostConnections: vi.fn(),
  listFinanceAnswerContinuations: vi.fn(),
  listFinanceHostRuns: vi.fn(),
  recoverFinanceHostRun: vi.fn(),
  reconcileFinanceHostDelivery: vi.fn(),
  createAutomationHostSchedule: vi.fn(),
  bindAutomationHostSchedule: vi.fn(),
  cancelAutomationHostSchedule: vi.fn(),
  saveAutomationHostFireToken: vi.fn(),
  revokeAutomationHostSchedule: vi.fn(),
  bindFinanceAnswerContinuation: vi.fn(),
}));
vi.mock("../../api.js", () => ({ api: mocks }));
const id = "11111111-1111-4111-8111-111111111111";
function schedule(
  surface: "codex_desktop" | "claude_code_routine" = "codex_desktop",
  state = "setup_pending",
) {
  return {
    schedule: { id, label: "My Finance host", hostSurface: surface, state, version: 3 },
    health: { state },
  };
}
function show() {
  return render(
    <MemoryRouter>
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
          })
        }
      >
        <FinanceHostSettings />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.listAutomationHostSchedules.mockResolvedValue([]);
  mocks.listAutomationHostConnections.mockResolvedValue([
    { id, label: "Original grant", scopes: ["finances:maintain"] },
  ]);
  mocks.listFinanceAnswerContinuations.mockResolvedValue([]);
  mocks.listFinanceHostRuns.mockResolvedValue([]);
});
it("prepares a host only after a human chooses its authorized connection", async () => {
  const user = userEvent.setup();
  show();
  const button = await screen.findByRole("button", { name: "Prepare host setup" });
  expect(button).toBeDisabled();
  await user.selectOptions(screen.getByLabelText("Authorized host connection"), id);
  await user.click(button);
  await waitFor(() =>
    expect(mocks.createAutomationHostSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantAuthorizationConnectionId: id,
        hostSurface: "codex_desktop",
        requestedScopes: ["finances:maintain"],
      }),
    ),
  );
  await user.selectOptions(screen.getByLabelText("Host"), "claude_code_routine");
  await user.click(button);
  await waitFor(() =>
    expect(mocks.createAutomationHostSchedule).toHaveBeenLastCalledWith(
      expect.objectContaining({
        hostSurface: "claude_code_routine",
        trigger: { type: "event", expectedMaximumLatencyMinutes: 5 },
      }),
    ),
  );
});
it("binds the exact setup version and lets unfinished setup be cancelled", async () => {
  mocks.listAutomationHostSchedules.mockResolvedValue([schedule()]);
  const user = userEvent.setup();
  show();
  expect(((await screen.findByLabelText("Host prompt")) as HTMLTextAreaElement).value).toContain(
    "operation start",
  );
  await user.type(screen.getByLabelText("Host automation identifier"), "original-host");
  await user.type(screen.getByLabelText("Next host run"), "2026-12-20T15:00");
  await user.click(screen.getByRole("button", { name: "Bind host" }));
  await waitFor(() =>
    expect(mocks.bindAutomationHostSchedule).toHaveBeenCalledWith(
      id,
      expect.objectContaining({
        expectedVersion: 3,
        expectedState: "setup_pending",
        hostAutomationId: "original-host",
        hostSurface: "codex_desktop",
      }),
    ),
  );
  await user.click(screen.getByRole("button", { name: "Cancel setup" }));
  await waitFor(() =>
    expect(mocks.cancelAutomationHostSchedule).toHaveBeenCalledWith(id, {
      expectedVersion: 3,
      expectedState: "setup_pending",
    }),
  );
});
it("clears the encrypted trigger input after save and surfaces stale-version rejection", async () => {
  mocks.listAutomationHostSchedules.mockResolvedValue([schedule("claude_code_routine", "active")]);
  const user = userEvent.setup();
  show();
  const token = await screen.findByLabelText("Routine API trigger token");
  expect(token).toHaveAttribute("type", "password");
  await user.type(token, "sk-ant-oat01-abcdefghijklmno");
  await user.click(screen.getByRole("button", { name: "Save trigger token" }));
  await waitFor(() => expect(token).toHaveValue(""));
  expect(mocks.saveAutomationHostFireToken).toHaveBeenCalledWith(id, {
    token: "sk-ant-oat01-abcdefghijklmno",
    expectedVersion: 3,
  });
  mocks.revokeAutomationHostSchedule.mockRejectedValue(
    new Error("The host schedule state changed."),
  );
  await user.click(screen.getByRole("button", { name: "Revoke continuation access" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("The host schedule state changed.");
});
it("shows waiting answers and ambiguous delivery without suggesting an automatic retry", async () => {
  mocks.listAutomationHostSchedules.mockResolvedValue([schedule("codex_desktop", "active")]);
  mocks.listFinanceAnswerContinuations.mockResolvedValue([
    {
      id: "waiting",
      reviewCaseId: id,
      state: "pending",
      automationScheduleId: null,
      fireState: "pending",
    },
    {
      id: "uncertain",
      reviewCaseId: id,
      state: "pending",
      automationScheduleId: id,
      fireState: "uncertain",
    },
  ]);
  const user = userEvent.setup();
  show();
  expect(await screen.findByText(/Choose a host to continue/)).toBeInTheDocument();
  expect(screen.getByText(/Host execution is unconfirmed/)).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: "Review source" })[0]).toHaveAttribute(
    "href",
    `/finances/review?case=${id}`,
  );
  await user.selectOptions(screen.getByLabelText("Choose continuation host"), id);
  await waitFor(() =>
    expect(mocks.bindFinanceAnswerContinuation).toHaveBeenCalledWith("waiting", id),
  );
});
it("explains a missing grant without displaying a setup form", async () => {
  mocks.listAutomationHostConnections.mockResolvedValue([]);
  show();
  expect(await screen.findByText(/explicitly authorize Finance maintenance/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Prepare host setup" })).not.toBeInTheDocument();
});

it("moves an idle run only after explicit inspection and sends its original binding fence", async () => {
  const user = userEvent.setup();
  mocks.listAutomationHostSchedules.mockResolvedValue([schedule("codex_desktop", "active")]);
  mocks.listFinanceHostRuns.mockResolvedValue([
    {
      id: "run-id",
      status: "awaiting_agent_challenge",
      automationScheduleId: "old-host",
      authorizationConnectionId: "old-connection",
      updatedAt: "2026-10-09T15:00:00.000Z",
    },
  ]);
  show();
  const button = await screen.findByRole("button", { name: "Move waiting run to host" });
  expect(button).toBeDisabled();
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Replacement host for waiting run" }),
    id,
  );
  expect(button).toBeDisabled();
  await user.click(
    screen.getByRole("checkbox", {
      name: "I checked the original host and stopped its work on this run.",
    }),
  );
  await user.click(button);
  await waitFor(() =>
    expect(mocks.recoverFinanceHostRun).toHaveBeenCalledWith("run-id", {
      scheduleId: id,
      expectedScheduleId: "old-host",
      expectedConnectionId: "old-connection",
      expectedUpdatedAt: "2026-10-09T15:00:00.000Z",
      hostChecked: true,
    }),
  );
});
it("keeps uncertain delivery fenced until human inspection and shows a stale-recovery failure", async () => {
  const user = userEvent.setup();
  mocks.listFinanceAnswerContinuations.mockResolvedValue([
    {
      id: "answer-id",
      reviewCaseId: id,
      state: "pending",
      automationScheduleId: id,
      maintenanceRunId: null,
      fireState: "uncertain",
      updatedAt: "2026-10-09T15:00:00.000Z",
    },
  ]);
  mocks.reconcileFinanceHostDelivery.mockRejectedValueOnce(
    new Error("Delivery changed. Reload before recovery."),
  );
  show();
  const button = await screen.findByRole("button", { name: "Release unconfirmed delivery" });
  expect(button).toBeDisabled();
  await user.click(
    screen.getByRole("checkbox", {
      name: "I checked the owning host; no session is running for this answer.",
    }),
  );
  await user.click(button);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Delivery changed. Reload before recovery.",
  );
  expect(mocks.reconcileFinanceHostDelivery).toHaveBeenCalledTimes(1);
  expect(mocks.bindFinanceAnswerContinuation).not.toHaveBeenCalled();
});

it("binds Claude setup without inventing a next scheduled slot", async () => {
  mocks.listAutomationHostSchedules.mockResolvedValue([schedule("claude_code_routine")]);
  const user = userEvent.setup();
  show();
  await user.type(
    await screen.findByLabelText("Host automation identifier"),
    "trig_abcdefghijklmno",
  );
  expect(screen.queryByLabelText("Next host run")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Bind host" }));
  await waitFor(() =>
    expect(mocks.bindAutomationHostSchedule).toHaveBeenCalledWith(id, {
      expectedVersion: 3,
      expectedState: "setup_pending",
      hostSurface: "claude_code_routine",
      hostAutomationId: "trig_abcdefghijklmno",
    }),
  );
});
it("keeps revoked connections out of recovery choices and shows each saved answer's actual state", async () => {
  mocks.listAutomationHostSchedules.mockResolvedValue([
    { ...schedule("codex_desktop", "active"), connectionAvailable: false },
    {
      ...schedule("codex_desktop", "paused"),
      schedule: {
        ...schedule("codex_desktop", "paused").schedule,
        id: "paused",
        label: "Paused host",
      },
    },
  ]);
  mocks.listFinanceAnswerContinuations.mockResolvedValue([
    {
      id: "accepted",
      reviewCaseId: id,
      state: "accepted",
      fireState: "accepted",
      maintenanceRunId: "run",
    },
    { id: "unavailable", reviewCaseId: id, state: "unavailable", fireState: "unavailable" },
    {
      id: "bound",
      reviewCaseId: id,
      state: "pending",
      fireState: "unavailable",
      automationScheduleId: id,
    },
    { id: "completed", reviewCaseId: id, state: "completed", fireState: "accepted" },
  ]);
  show();
  expect(await screen.findByText(/Connection unavailable/)).toBeInTheDocument();
  expect(screen.getByText(/Maintenance started/)).toBeInTheDocument();
  expect(screen.getByText(/Source unavailable/)).toBeInTheDocument();
  expect(screen.getByText(/Waiting for the bound host/)).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: "Review source" })).toHaveLength(3);
  expect(
    screen.getByRole("combobox", { name: "Choose continuation host" }).querySelectorAll("option"),
  ).toHaveLength(1);
  expect(mocks.bindFinanceAnswerContinuation).not.toHaveBeenCalled();
});
it("preserves a safe visible failure when a host write rejects without an Error object", async () => {
  mocks.listAutomationHostSchedules.mockResolvedValue([schedule("codex_desktop", "paused")]);
  mocks.revokeAutomationHostSchedule.mockRejectedValue("transport unavailable");
  const user = userEvent.setup();
  show();
  await user.click(await screen.findByRole("button", { name: "Revoke continuation access" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The host change could not be saved. Reload its status.",
  );
  expect(mocks.revokeAutomationHostSchedule).toHaveBeenCalledWith(id, {
    expectedVersion: 3,
    expectedState: "paused",
  });
});
