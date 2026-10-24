// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { FinanceAutomationsPage } from "./automations-page.js";
import { useFinanceWorkspaceReadiness } from "./use-finance-workspace-readiness";

const api = vi.hoisted(() => ({
  getFinanceOnboarding: vi.fn(),
  listAutomationHostSchedules: vi.fn(),
  listAutomationHostConnections: vi.fn(),
  getFinanceConversationReadiness: vi.fn(),
  getFinanceConversationHostReadiness: vi.fn(),
  issueFinanceConversationChallenge: vi.fn(),
  exchangeFinanceConversationChallenge: vi.fn(),
  createAutomationHostSchedule: vi.fn(),
  bindAutomationHostSchedule: vi.fn(),
  updateAutomationHostSchedule: vi.fn(),
  revokeAutomationHostSchedule: vi.fn(),
  cancelAutomationHostSchedule: vi.fn(),
}));
vi.mock("../../api.js", () => ({ api }));
vi.mock("sonner", () => ({
  toast: { loading: vi.fn(() => "notice"), success: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}));
const readiness = {
  canSend: false,
  reason: "challenge_required",
  recovery: "verify_message_protocol",
  messageCapability: "unverified",
};
function status(state = "active", event = false) {
  return {
    schedule: {
      id: "schedule-a",
      label: "Finance host",
      state,
      version: 7,
      hostSurface: event ? "claude_code_routine" : "codex_desktop",
      tenantAuthorizationConnectionId: "connection-original",
      createdAt: "2026-10-18T09:00:00Z",
      updatedAt: "2026-10-18T09:00:00Z",
      trigger: event
        ? { type: "event" }
        : { type: "recurring", recurrence: { everyMinutes: 1440, timeZone: "America/New_York" } },
    },
    connectionAvailable: true,
    health: {
      state: "overdue",
      lastObservedAt: "2026-10-18T10:00:00Z",
      nextExpectedAt: "2026-10-18T09:00:00Z",
      overdueAt: "2026-10-18T10:00:00Z",
      graceMilliseconds: 3600000,
    },
  };
}
function OwnerReadiness() {
  const query = useQuery({
    queryKey: ["finance-conversation-readiness", "owner-a"],
    queryFn: api.getFinanceConversationReadiness,
  });
  return <p>{query.data?.canSend ? "Owner Chat available" : "Owner Chat locked"}</p>;
}
function open(extra?: ReactNode, route = "/finances/automations") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["me"], { id: "owner-a" });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <FinanceAutomationsPage />
        {extra}
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return user;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(toast.loading).mockReturnValue("notice");
  api.listAutomationHostSchedules.mockResolvedValue([status()]);
  api.listAutomationHostConnections.mockResolvedValue([
    { id: "connection-original", label: "Original host", scopes: ["finances:maintain"] },
  ]);
  api.getFinanceConversationReadiness.mockResolvedValue(readiness);
  api.getFinanceConversationHostReadiness.mockResolvedValue(readiness);
});
it("separates server schedule health, observed evidence, and aggregate Chat readiness", async () => {
  api.getFinanceConversationReadiness.mockResolvedValue({ ...readiness, canSend: true });
  open();
  expect(await screen.findByText(/Chat is available/)).toBeInTheDocument();
  expect(await screen.findByText(/missed its expected check-in/)).toBeInTheDocument();
  expect(screen.getByText(/Grace: 60 minutes/)).toBeInTheDocument();
  expect(screen.getByText(/Successful maintenance is not established/)).toBeInTheDocument();
  expect(screen.getByText(/Message access for this host: unverified/)).toBeInTheDocument();
});
it("does not invent an event countdown", async () => {
  api.listAutomationHostSchedules.mockResolvedValue([status("active", true)]);
  open();
  expect(await screen.findByText(/Event-based · next run unknown/)).toBeInTheDocument();
  expect(screen.queryByText(/Next expected start/)).not.toBeInTheDocument();
});
it("issues a real challenge and checks actual readiness without exchanging as the human", async () => {
  api.issueFinanceConversationChallenge.mockResolvedValue({
    challengeId: "actual-challenge",
    nonce: "server-nonce",
    protocolVersion: "1",
    expiresAt: "2026-10-18T23:00:00Z",
  });
  const user = open();
  await user.click(await screen.findByRole("button", { name: "Verify message access" }));
  await user.click(screen.getByRole("button", { name: "Prepare verification challenge" }));
  expect(
    ((await screen.findByLabelText("Instructions for your original host")) as HTMLTextAreaElement)
      .value,
  ).toContain("actual-challenge");
  expect(api.issueFinanceConversationChallenge).toHaveBeenCalledWith("schedule-a");
  expect(api.exchangeFinanceConversationChallenge).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Check Chat readiness" }));
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith(
      "Readiness checked. This host is not ready for Finance Chat.",
      {
        id: "notice",
      },
    ),
  );
  expect(screen.queryByText("Verification challenge prepared.")).not.toBeInTheDocument();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});
it("registers only existing authorized connections and retains a failed draft with Sonner", async () => {
  api.createAutomationHostSchedule.mockRejectedValue(new Error("Registration unavailable"));
  const user = open();
  await user.click(screen.getByRole("button", { name: "Register automation" }));
  await user.clear(screen.getByLabelText("Name"));
  await user.type(screen.getByLabelText("Name"), "My saved draft");
  await user.selectOptions(screen.getByLabelText("Authorized connection"), "connection-original");
  await user.click(screen.getByRole("button", { name: "Register expected schedule" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Registration unavailable", { id: "notice" }),
  );
  expect(screen.getByLabelText("Name")).toHaveValue("My saved draft");
  expect(screen.queryByText("Registration unavailable")).not.toBeInTheDocument();
  expect(api.createAutomationHostSchedule).toHaveBeenCalledWith(
    expect.objectContaining({
      tenantAuthorizationConnectionId: "connection-original",
      requestedScopes: ["finances:maintain"],
      trigger: {
        type: "recurring",
        recurrence: { type: "interval", everyMinutes: 1440, timeZone: expect.any(String) },
      },
    }),
  );
});
it("binds setup with the original registration revision and expected state", async () => {
  api.listAutomationHostSchedules.mockResolvedValue([status("setup_pending", true)]);
  const user = open();
  await user.click(await screen.findByRole("button", { name: "Finish setup" }));
  await user.type(screen.getByLabelText("Host automation identifier"), "real-host-id");
  await user.click(screen.getByRole("button", { name: "Bind existing host job" }));
  await waitFor(() =>
    expect(api.bindAutomationHostSchedule).toHaveBeenCalledWith("schedule-a", {
      hostSurface: "claude_code_routine",
      hostAutomationId: "real-host-id",
      expectedVersion: 7,
      expectedState: "setup_pending",
    }),
  );
});
it("requires removal confirmation and fences the original state/version", async () => {
  const user = open();
  await user.click(await screen.findByRole("button", { name: "Remove registration" }));
  expect(api.revokeAutomationHostSchedule).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Confirm removal" }));
  await waitFor(() =>
    expect(api.revokeAutomationHostSchedule).toHaveBeenCalledWith("schedule-a", {
      expectedVersion: 7,
      expectedState: "active",
    }),
  );
});
it("distinguishes execution authorization from connection recovery", async () => {
  api.getFinanceConversationReadiness.mockResolvedValue({
    ...readiness,
    recovery: "authorize_execution",
    reason: "execution_not_authorized",
  });
  open();
  expect(await screen.findByText(/does not have Finance execution permission/)).toBeInTheDocument();
  expect(screen.queryByText(/Reconnect your authorized host/)).not.toBeInTheDocument();
});

it("updates individual host readiness only from its actual server proof", async () => {
  const user = open();
  expect(await screen.findByText(/Message access for this host: unverified/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Verify message access" }));
  api.getFinanceConversationHostReadiness.mockResolvedValue({
    ...readiness,
    canSend: true,
    messageCapability: "verified",
  });
  await user.click(screen.getByRole("button", { name: "Check Chat readiness" }));
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("This host is ready for Finance Chat.", {
      id: "notice",
    }),
  );
  expect(api.getFinanceConversationHostReadiness).toHaveBeenCalledWith("schedule-a");
  expect(screen.getByText(/Message access for this host: verified/)).toBeInTheDocument();
});
it("retains a real challenge on copy failure with no inline action error", async () => {
  api.issueFinanceConversationChallenge.mockResolvedValue({
    challengeId: "actual-challenge",
    nonce: "server-nonce",
    protocolVersion: "1",
    expiresAt: "2026-10-18T23:00:00Z",
  });
  const user = open();
  await user.click(await screen.findByRole("button", { name: "Verify message access" }));
  await user.click(screen.getByRole("button", { name: "Prepare verification challenge" }));
  await screen.findByLabelText("Instructions for your original host");
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("Clipboard unavailable"));
  await user.click(screen.getByRole("button", { name: "Copy verification instructions" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Clipboard unavailable", { id: "notice" }),
  );
  expect(screen.queryByText("Clipboard unavailable")).not.toBeInTheDocument();
  expect(
    (screen.getByLabelText("Instructions for your original host") as HTMLTextAreaElement).value,
  ).toContain("actual-challenge");
});
it("announces load failures through Sonner without an inline error", async () => {
  api.listAutomationHostSchedules.mockRejectedValue(new Error("offline"));
  open();
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Automations could not be loaded", expect.any(Object)),
  );
  expect(screen.queryByText("Automations could not be loaded")).not.toBeInTheDocument();
});

it("refreshes host and owner-qualified Chat readiness after replacement verification", async () => {
  const verified = { ...readiness, canSend: true, messageCapability: "verified" };
  api.getFinanceConversationReadiness.mockResolvedValue(verified);
  api.getFinanceConversationHostReadiness.mockResolvedValue(verified);
  api.issueFinanceConversationChallenge.mockResolvedValue({
    challengeId: "replacement-challenge",
    nonce: "actual-nonce",
    protocolVersion: "1",
    expiresAt: "2026-10-18T23:00:00Z",
  });
  const user = open(<OwnerReadiness />);
  await screen.findByText("Owner Chat available");
  await screen.findByText(/Message access for this host: verified/);
  api.getFinanceConversationReadiness.mockResolvedValue(readiness);
  api.getFinanceConversationHostReadiness.mockResolvedValue(readiness);
  await user.click(screen.getByRole("button", { name: "Verify message access" }));
  await user.click(screen.getByRole("button", { name: "Prepare verification challenge" }));
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Verification challenge prepared.", {
      id: "notice",
    }),
  );
  expect(screen.getByText("Owner Chat locked")).toBeInTheDocument();
  expect(screen.getByText(/Message access for this host: unverified/)).toBeInTheDocument();
  expect(screen.queryByText(/Chat is available through/)).not.toBeInTheDocument();
  expect(api.exchangeFinanceConversationChallenge).not.toHaveBeenCalled();
});
it("preserves an issued replacement challenge when readiness refresh fails without stale verified claims", async () => {
  const verified = { ...readiness, canSend: true, messageCapability: "verified" };
  api.getFinanceConversationReadiness.mockResolvedValue(verified);
  api.getFinanceConversationHostReadiness.mockResolvedValue(verified);
  api.issueFinanceConversationChallenge.mockResolvedValue({
    challengeId: "replacement-challenge",
    nonce: "actual-nonce",
    protocolVersion: "1",
    expiresAt: "2026-10-18T23:00:00Z",
  });
  const user = open(<OwnerReadiness />);
  await screen.findByText("Owner Chat available");
  await screen.findByText(/Message access for this host: verified/);
  api.getFinanceConversationReadiness.mockRejectedValue(new Error("Readiness offline"));
  api.getFinanceConversationHostReadiness.mockRejectedValue(new Error("Readiness offline"));
  await user.click(screen.getByRole("button", { name: "Verify message access" }));
  await user.click(screen.getByRole("button", { name: "Prepare verification challenge" }));
  const message =
    "Challenge prepared, but readiness could not be refreshed. Check Chat readiness again.";
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message, { id: "notice" }));
  expect(
    (screen.getByLabelText("Instructions for your original host") as HTMLTextAreaElement).value,
  ).toContain("replacement-challenge");
  expect(screen.getByText("Owner Chat locked")).toBeInTheDocument();
  expect(screen.queryByText(/Message access for this host: verified/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Chat is available through/)).not.toBeInTheDocument();
  expect(screen.queryByText(message)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Copy verification instructions" })).toBeEnabled();
});

it("keeps saved instructions neutral when the actual host is already verified", async () => {
  api.getFinanceConversationHostReadiness.mockResolvedValue({
    ...readiness,
    canSend: true,
    messageCapability: "verified",
  });
  const user = open();
  await screen.findByText(/Message access for this host: verified/);
  await user.click(screen.getByRole("button", { name: "Instructions" }));
  expect(screen.getByRole("dialog", { name: "Finance host instructions" })).toBeInTheDocument();
  expect(screen.getByText(/Installation status is unknown/)).toBeInTheDocument();
  expect(screen.queryByText(/Chat verification is pending/)).not.toBeInTheDocument();
});

function ManualControlsReadiness() {
  const state = useFinanceWorkspaceReadiness();
  return (
    <p>
      {state.manualCreationVisible === true
        ? "Manual capture visible"
        : state.manualCreationVisible === false
          ? "Manual capture hidden"
          : "Manual capture unknown"}
    </p>
  );
}
it("refreshes actual onboarding projection only after a confirmed host mutation", async () => {
  const snapshot = (count: number) => ({
    revision: 0,
    completedAt: null,
    existingAccess: true,
    source: { state: "usable", summary: "Source", recoveryHref: null },
    contextReview: "needs_review",
    questions: [],
    displayPreferences: { reviewed: false, summary: [] },
    automationChoice: null,
    manualVisibility: "auto",
    automation: {
      registrationCount: count,
      authorizedRegistrationWithCadence: false,
      chatVerification: "pending",
      canSendChat: false,
      historyAvailable: false,
    },
  });
  api.getFinanceOnboarding.mockResolvedValue(snapshot(1));
  api.revokeAutomationHostSchedule.mockRejectedValueOnce(new Error("Not removed"));
  const user = open(<ManualControlsReadiness />);
  await screen.findByText("Manual capture hidden");
  await user.click(await screen.findByRole("button", { name: "Remove registration" }));
  await user.click(screen.getByRole("button", { name: "Confirm removal" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Not removed", { id: "notice" }));
  expect(api.getFinanceOnboarding).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Manual capture hidden")).toBeInTheDocument();
  api.revokeAutomationHostSchedule.mockImplementationOnce(async () => {
    api.getFinanceOnboarding.mockResolvedValue(snapshot(0));
    return status("revoked");
  });
  await user.click(screen.getByRole("button", { name: "Confirm removal" }));
  await screen.findByText("Manual capture visible");
  expect(api.getFinanceOnboarding).toHaveBeenCalledTimes(2);
});

it("shows an honest empty registration list", async () => {
  api.listAutomationHostSchedules.mockResolvedValue([]);
  open();
  expect(await screen.findByText("No Finance automations registered.")).toBeInTheDocument();
});
it("cancels pending setup with the original version and closes after confirmation", async () => {
  api.listAutomationHostSchedules.mockResolvedValue([status("setup_pending")]);
  const user = open();
  await user.click(await screen.findByRole("button", { name: "Cancel setup" }));
  await user.click(screen.getByRole("button", { name: "Confirm cancellation" }));
  await waitFor(() =>
    expect(api.cancelAutomationHostSchedule).toHaveBeenCalledWith("schedule-a", {
      expectedVersion: 7,
      expectedState: "setup_pending",
    }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});
it("saves a renamed paused registration and preserves revision fencing", async () => {
  api.listAutomationHostSchedules.mockResolvedValue([status("paused")]);
  const user = open();
  await user.click(await screen.findByRole("button", { name: "Review host setup" }));
  await user.clear(screen.getByLabelText("Name"));
  await user.type(screen.getByLabelText("Name"), "Weekly review");
  await user.click(screen.getByRole("button", { name: "Save name" }));
  await waitFor(() =>
    expect(api.updateAutomationHostSchedule).toHaveBeenCalledWith("schedule-a", {
      expectedVersion: 7,
      label: "Weekly review",
    }),
  );
  expect(toast.success).toHaveBeenCalledWith("Automation name saved.", { id: "notice" });
});
it("uses safe fallback feedback for a non-Error failure and retains cancellation", async () => {
  api.listAutomationHostSchedules.mockResolvedValue([status("setup_pending")]);
  api.cancelAutomationHostSchedule.mockRejectedValue({ secret: "must not render" });
  const user = open();
  await user.click(await screen.findByRole("button", { name: "Cancel setup" }));
  await user.click(screen.getByRole("button", { name: "Confirm cancellation" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "The automation could not be saved. Reload its status and try again.",
      { id: "notice" },
    ),
  );
  expect(screen.getByRole("button", { name: "Confirm cancellation" })).toBeEnabled();
  expect(screen.queryByText(/must not render/)).not.toBeInTheDocument();
});
it.each([
  "revoked",
  "cancelled",
])("retains %s history without offering name or removal mutations", async (state) => {
  api.listAutomationHostSchedules.mockResolvedValue([status(state)]);
  const user = open();
  await user.click(await screen.findByRole("button", { name: "Review host setup" }));
  expect(screen.queryByRole("button", { name: "Save name" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Remove registration" })).not.toBeInTheDocument();
  expect(screen.getByText("connection-original")).toBeInTheDocument();
});
it("reports missing observations and disables verification for an unavailable connection", async () => {
  const missing = status();
  api.listAutomationHostSchedules.mockResolvedValue([
    {
      ...missing,
      connectionAvailable: false,
      health: {
        ...missing.health,
        nextExpectedAt: null,
        lastObservedAt: null,
        overdueAt: null,
        graceMilliseconds: null,
      },
    },
  ]);
  open();
  expect(await screen.findByText(/original host connection is unavailable/)).toBeInTheDocument();
  expect(screen.getByText(/Next expected start: Not reported/)).toBeInTheDocument();
  expect(screen.getByText(/Host observation: Not reported/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Verify message access" })).toBeDisabled();
  expect(screen.queryByText(/Grace:/)).not.toBeInTheDocument();
});
it.each([
  false,
  true,
])("shows the saved prompt version and upgrade state %s", async (upgradeAvailable) => {
  api.listAutomationHostSchedules.mockResolvedValue([
    { ...status(), prompt: { latestIssued: { templateVersion: "v2" }, upgradeAvailable } },
  ]);
  const user = open();
  await user.click(await screen.findByRole("button", { name: "Review host setup" }));
  expect(
    screen.getByText(upgradeAvailable ? "Saved version v2 · Update available" : "Saved version v2"),
  ).toBeInTheDocument();
});

it("routes an unavailable original connection to reconnection without offering verification", async () => {
  api.listAutomationHostSchedules.mockResolvedValue([{ ...status(), connectionAvailable: false }]);
  open();
  const reconnect = await screen.findByRole("link", { name: "Reconnect host" });
  expect(reconnect).toHaveAttribute("href", "/settings?section=agent-connections");
  expect(screen.getByRole("button", { name: "Verify message access" })).toBeDisabled();
  expect(api.issueFinanceConversationChallenge).not.toHaveBeenCalled();
});

it.each([
  null,
  "https://outside.example/",
  "//outside.example/",
  "/finances/chat?bad=%ZZ",
])("keeps both host recovery links plain when contextual return is absent or unsafe: %s", async (returnTo) => {
  api.getFinanceConversationReadiness.mockResolvedValue({
    ...readiness,
    reason: "connection_disconnected",
  });
  api.listAutomationHostSchedules.mockResolvedValue([{ ...status(), connectionAvailable: false }]);
  open(
    undefined,
    `/finances/automations${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`,
  );
  await waitFor(() =>
    expect(screen.getAllByRole("link", { name: "Reconnect host" })).toHaveLength(2),
  );
  for (const link of screen.getAllByRole("link", { name: "Reconnect host" })) {
    expect(link).toHaveAttribute("href", "/settings?section=agent-connections");
  }
  expect(screen.queryByRole("link", { name: "Return to conversation" })).not.toBeInTheDocument();
});

it("offers host setup for an overdue run without claiming to reschedule the external job", async () => {
  const user = open();
  await user.click(await screen.findByRole("button", { name: "Review host setup" }));
  expect(screen.getByRole("dialog")).toHaveTextContent(/external job in its host separately/);
  expect(api.updateAutomationHostSchedule).not.toHaveBeenCalled();
  expect(api.bindAutomationHostSchedule).not.toHaveBeenCalled();
});

it("returns to the exact contextual conversation after recovery without allowing an external return", async () => {
  open(
    undefined,
    "/finances/automations?returnTo=%2Ffinances%2Fchat%3Fquestion%3Dquestion-a%26message%3Dmessage-a",
  );
  expect(await screen.findByRole("link", { name: "Return to conversation" })).toHaveAttribute(
    "href",
    "/finances/chat?question=question-a&message=message-a",
  );
});

it.each([
  "https://example.com",
  "//example.com",
  "/settings",
])("does not offer an unsafe recovery return to %s", async (returnTo) => {
  open(undefined, `/finances/automations?returnTo=${encodeURIComponent(returnTo)}`);
  await screen.findByRole("heading", { name: "Finance host" });
  expect(screen.queryByRole("link", { name: "Return to conversation" })).not.toBeInTheDocument();
});

it.each([
  ["paused", "paused", "Review host setup"],
  ["active", "unknown", "Review host setup"],
  ["setup_pending", "setup_pending", "Finish setup"],
])("keeps %s registration recovery inspectable without changing the host", async (state, healthState, action) => {
  const record = status(state);
  api.listAutomationHostSchedules.mockResolvedValue([
    { ...record, health: { ...record.health, state: healthState } },
  ]);
  const user = open();
  await user.click(await screen.findByRole("button", { name: action }));
  expect(screen.getByRole("dialog")).toHaveTextContent(
    /Create, change, or stop the external job in its host separately/,
  );
  expect(api.bindAutomationHostSchedule).not.toHaveBeenCalled();
  expect(api.updateAutomationHostSchedule).not.toHaveBeenCalled();
});

it("uses the actual registration control when no host is registered", async () => {
  api.listAutomationHostSchedules.mockResolvedValue([]);
  api.getFinanceConversationReadiness.mockResolvedValue({
    ...readiness,
    reason: "registration_missing",
    recovery: "register_host",
  });
  const user = open();
  await screen.findByText("No Finance automations registered.");
  expect(screen.queryByRole("link", { name: "Set up automation" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Register automation" }));
  expect(screen.getByRole("dialog", { name: "Register Finance automation" })).toBeInTheDocument();
  expect(api.createAutomationHostSchedule).not.toHaveBeenCalled();
});

it("shows the shared agent identity without replacing automation or host state", async () => {
  const { agentAccountFixture } = await import("../../test-fixtures/agent-account");
  api.listAutomationHostSchedules.mockResolvedValue([
    { ...status(), agentAccount: agentAccountFixture },
  ]);
  open();
  expect(await screen.findByText("Cedar Fox")).toBeVisible();
  expect(screen.getByText("Codex · Personal")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Finance host" })).toBeVisible();
  expect(screen.getByText(/This host missed its expected check-in/)).toBeVisible();
});

it("registers daily Claude wall times without interval or API credentials", async () => {
  api.createAutomationHostSchedule.mockResolvedValue({});
  const user = open();
  await user.click(screen.getByRole("button", { name: "Register automation" }));
  await user.selectOptions(screen.getByLabelText("Host"), "claude_scheduled");
  await user.selectOptions(
    await screen.findByLabelText("Authorized connection"),
    "connection-original",
  );
  await user.clear(screen.getByLabelText("Timezone"));
  await user.type(screen.getByLabelText("Timezone"), "America/New_York");
  expect(screen.queryByLabelText("Interval in minutes")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Maximum event latency in minutes")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Register expected schedule" }));
  await waitFor(() =>
    expect(api.createAutomationHostSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        hostSurface: "claude_code_routine",
        tenantAuthorizationConnectionId: "connection-original",
        trigger: {
          type: "scheduled",
          localTimes: ["08:00", "20:00"],
          timeZone: "America/New_York",
        },
      }),
    ),
  );
  expect(toast.success).toHaveBeenCalledWith(
    "Automation registered. Set it up in your host.",
    expect.anything(),
  );
  expect(
    screen.queryByText("Automation registered. Set it up in your host."),
  ).not.toBeInTheDocument();
});
it("shows scheduled cadence and delayed continuation without an API token form", async () => {
  const scheduled = status("active", true);
  api.listAutomationHostSchedules.mockResolvedValue([
    {
      ...scheduled,
      schedule: {
        ...scheduled.schedule,
        trigger: {
          type: "scheduled",
          localTimes: ["08:00", "20:00"],
          timeZone: "America/New_York",
        },
      },
    },
  ]);
  const user = open();
  expect(await screen.findByText(/Daily at 08:00 and 20:00/)).toBeInTheDocument();
  expect(screen.getByText(/Projected next start/)).toBeInTheDocument();
  expect(
    screen.getByText(/Saved answers wait for the next scheduled invocation/),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Review host setup" }));
  expect(screen.getByRole("dialog", { name: "Finance host" })).toBeInTheDocument();
  expect(screen.queryByLabelText("Routine API trigger token")).not.toBeInTheDocument();
});

it("shows the API token control for an event routine inside its setup dialog", async () => {
  api.listAutomationHostSchedules.mockResolvedValue([status("active", true)]);
  const user = open();
  await user.click(await screen.findByRole("button", { name: "Review host setup" }));
  expect(screen.getByRole("dialog", { name: "Finance host" })).toBeInTheDocument();
  expect(screen.getByLabelText("Routine API trigger token")).toBeInTheDocument();
});
it("formats projected starts and grace deadlines in the declared zone instead of the browser zone", async () => {
  // Model a Los Angeles browser even when the test runner's host uses another timezone.
  const format = Date.prototype.toLocaleString;
  const browser = vi.spyOn(Date.prototype, "toLocaleString").mockImplementation(function (
    this: Date,
    locales,
    options,
  ) {
    return format.call(this, locales, { timeZone: "America/Los_Angeles", ...options });
  });
  try {
    const scheduled = status("active", true);
    api.listAutomationHostSchedules.mockResolvedValue([
      {
        ...scheduled,
        schedule: {
          ...scheduled.schedule,
          trigger: {
            type: "scheduled",
            localTimes: ["08:00", "20:00"],
            timeZone: "America/New_York",
          },
        },
        health: {
          ...scheduled.health,
          nextExpectedAt: "2026-10-18T12:00:00Z",
          overdueAt: "2026-10-18T12:15:00Z",
          graceMilliseconds: 900000,
        },
      },
    ]);
    open();
    const projected = await screen.findByText(/Projected next start/);
    expect(projected).toHaveTextContent("8:00:00 AM EDT (America/New_York)");
    expect(projected).toHaveTextContent("8:15:00 AM EDT (America/New_York)");
    expect(projected).not.toHaveTextContent("5:00:00 AM");
  } finally {
    browser.mockRestore();
  }
});
