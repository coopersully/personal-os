// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  AutomationBinding,
  AutomationRegistration,
  type HostStatus,
} from "./automation-registration";

const api = vi.hoisted(() => ({
  listAutomationHostConnections: vi.fn(),
  createAutomationHostSchedule: vi.fn(),
  bindAutomationHostSchedule: vi.fn(),
  saveAutomationHostFireToken: vi.fn(),
}));
vi.mock("../../api.js", () => ({ api }));
const perform = vi.fn(async (action: () => Promise<unknown>) => {
  await action();
  return true;
});
beforeEach(() => {
  vi.resetAllMocks();
  perform.mockImplementation(async (action) => {
    await action();
    return true;
  });
  api.listAutomationHostConnections.mockResolvedValue([
    { id: "allowed", label: "Authorized host", scopes: ["finances:maintain"] },
    { id: "read-only", label: "Read only", scopes: ["finances:read"] },
  ]);
});
function registration(pending = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["me"], { id: "owner-a" });
  render(
    <QueryClientProvider client={client}>
      <AutomationRegistration pending={pending} perform={perform} />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}
function binding(state: string, hostSurface: string, connectionAvailable = true, pending = false) {
  const status = {
    schedule: { id: "schedule", state, hostSurface, version: 9 },
    connectionAvailable,
  } as HostStatus;
  render(<AutomationBinding status={status} pending={pending} perform={perform} />);
  return userEvent.setup();
}
it("validates recurring cadence before registering and closes only after acceptance", async () => {
  const user = registration();
  await user.click(screen.getByRole("button", { name: "Register automation" }));
  await user.selectOptions(await screen.findByLabelText("Authorized connection"), "allowed");
  expect(screen.queryByRole("option", { name: "Read only" })).not.toBeInTheDocument();
  const interval = screen.getByLabelText("Interval in minutes");
  await user.clear(interval);
  await user.type(interval, "10081");
  await user.click(screen.getByRole("button", { name: "Register expected schedule" }));
  expect(perform).not.toHaveBeenCalled();
  await user.clear(interval);
  await user.type(interval, "60");
  await user.clear(screen.getByLabelText("Timezone"));
  await user.type(screen.getByLabelText("Timezone"), "UTC");
  await user.click(screen.getByRole("button", { name: "Register expected schedule" }));
  await waitFor(() =>
    expect(api.createAutomationHostSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        hostSurface: "codex_desktop",
        trigger: {
          type: "recurring",
          recurrence: { type: "interval", everyMinutes: 60, timeZone: "UTC" },
        },
      }),
    ),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});
it("uses event latency and resets cadence on host changes", async () => {
  const user = registration();
  await user.click(screen.getByRole("button", { name: "Register automation" }));
  await user.selectOptions(await screen.findByLabelText("Authorized connection"), "allowed");
  await user.selectOptions(screen.getByLabelText("Host"), "claude_code_routine");
  expect(screen.queryByLabelText("Timezone")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Maximum event latency in minutes")).toHaveValue(5);
  await user.clear(screen.getByLabelText("Maximum event latency in minutes"));
  await user.type(screen.getByLabelText("Maximum event latency in minutes"), "61");
  await user.click(screen.getByRole("button", { name: "Register expected schedule" }));
  expect(perform).not.toHaveBeenCalled();
  await user.selectOptions(screen.getByLabelText("Host"), "codex_desktop");
  expect(screen.getByLabelText("Interval in minutes")).toHaveValue(1440);
  await user.selectOptions(screen.getByLabelText("Host"), "claude_code_routine");
  await user.click(screen.getByRole("button", { name: "Register expected schedule" }));
  await waitFor(() =>
    expect(api.createAutomationHostSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        hostSurface: "claude_code_routine",
        trigger: { type: "event", expectedMaximumLatencyMinutes: 5 },
      }),
    ),
  );
});
it("explains missing maintenance authority and disables submission", async () => {
  api.listAutomationHostConnections.mockResolvedValue([]);
  const user = registration();
  await user.click(screen.getByRole("button", { name: "Register automation" }));
  expect(
    await screen.findByText(/Connect a host with Finance maintenance permission/),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Register expected schedule" })).toBeDisabled();
});
it("keeps accepted connection selection disabled during a pending save", async () => {
  const user = registration(true);
  await user.click(screen.getByRole("button", { name: "Register automation" }));
  await user.selectOptions(await screen.findByLabelText("Authorized connection"), "allowed");
  expect(screen.getByRole("button", { name: "Register expected schedule" })).toBeDisabled();
});
it("binds a recurring host using the local next-run instant and original revision", async () => {
  const user = binding("setup_pending", "codex_desktop");
  await user.type(screen.getByLabelText("Host automation identifier"), "host-job");
  const next = screen.getByLabelText("Next run in your local time");
  // datetime-local is intentionally interpreted in the user's local timezone.
  const { fireEvent } = await import("@testing-library/react");
  fireEvent.change(next, { target: { value: "2026-10-20T09:30" } });
  await user.click(screen.getByRole("button", { name: "Bind existing host job" }));
  expect(api.bindAutomationHostSchedule).toHaveBeenCalledWith("schedule", {
    hostSurface: "codex_desktop",
    expectedVersion: 9,
    expectedState: "setup_pending",
    hostAutomationId: "host-job",
    nextExpectedAt: new Date("2026-10-20T09:30").toISOString(),
  });
});
it.each([
  true,
  false,
])("clears a routine trigger secret only on accepted outcome %s", async (saved) => {
  perform.mockImplementation(async (action) => {
    await action();
    return saved;
  });
  const user = binding("active", "claude_code_routine");
  await user.type(screen.getByLabelText("Routine API trigger token"), "private-trigger");
  await user.click(screen.getByRole("button", { name: "Save trigger token" }));
  expect(api.saveAutomationHostFireToken).toHaveBeenCalledWith("schedule", {
    token: "private-trigger",
    expectedVersion: 9,
  });
  await waitFor(() =>
    expect(screen.getByLabelText("Routine API trigger token")).toHaveValue(
      saved ? "" : "private-trigger",
    ),
  );
});
it.each([
  ["setup_pending", "codex_desktop"],
  ["active", "claude_code_routine"],
])("blocks %s binding without the original connection", (state, host) => {
  binding(state, host, false);
  expect(screen.getByRole("button")).toBeDisabled();
});
it("offers no binding mutation for a paused recurring host", () => {
  binding("paused", "codex_desktop");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it("shows the supplied profile while registering against the authorized connection", async () => {
  const { agentAccountFixture } = await import("../../test-fixtures/agent-account");
  api.listAutomationHostConnections.mockResolvedValue([
    {
      id: "allowed",
      label: "Authorized host",
      scopes: ["finances:maintain"],
      agentAccount: agentAccountFixture,
    },
    {
      id: "read-only",
      label: "Read only",
      scopes: ["finances:read"],
      agentAccount: agentAccountFixture,
    },
  ]);
  const user = registration();
  await user.click(screen.getByRole("button", { name: "Register automation" }));
  expect(await screen.findByRole("option", { name: "Cedar Fox · Authorized host" })).toBeVisible();
  await user.selectOptions(screen.getByLabelText("Authorized connection"), "allowed");
  expect(screen.getByText("Codex · Personal")).toBeVisible();
  expect(screen.queryByRole("option", { name: /Read only/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Register expected schedule" }));
  await waitFor(() =>
    expect(api.createAutomationHostSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantAuthorizationConnectionId: "allowed",
        requestedScopes: ["finances:maintain"],
      }),
    ),
  );
});
