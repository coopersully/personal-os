// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { toast } from "sonner";
import { HostPromptPanel } from "./host-prompt-panel.js";

const api = vi.hoisted(() => ({
  getAutomationHostPromptHistory: vi.fn(),
  issueAutomationHostPrompt: vi.fn(),
}));
vi.mock("../../api.js", () => ({ api }));
vi.mock("sonner", () => ({
  toast: { loading: vi.fn(() => "notice"), success: vi.fn(), error: vi.fn() },
}));
const issue = (version = 1) => ({
  scheduleId: "schedule-a",
  templateVersion: version,
  scheduleVersionAtIssue: 2,
  text: `Exact saved instructions ${version}\nKeep this whitespace.`,
  issuedAt: "2026-10-18T22:00:00Z",
});
function status(overrides: Record<string, unknown> = {}) {
  return {
    schedule: { id: "schedule-a", label: "My host", state: "active", version: 7 },
    connectionAvailable: true,
    prompt: {
      latestIssued: issue(),
      currentTemplateVersion: 2,
      upgradeAvailable: true,
      externalAdoption: "unknown",
    },
    ...overrides,
  } as ComponentProps<typeof HostPromptPanel>["status"];
}
async function open(value = status()) {
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <HostPromptPanel status={value} />
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Instructions" }));
  return user;
}
beforeEach(() => {
  vi.resetAllMocks();
  api.getAutomationHostPromptHistory.mockResolvedValue({
    issues: [issue()],
    nextCursor: null,
    currentTemplateVersion: 2,
  });
});
it("copies exact stored text without issuing or claiming installation", async () => {
  const user = await open();
  const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  expect(screen.getByLabelText("Host prompt")).toHaveValue(issue().text);
  await user.click(screen.getByRole("button", { name: "Copy instructions" }));
  expect(write).toHaveBeenCalledWith(issue().text);
  expect(api.issueAutomationHostPrompt).not.toHaveBeenCalled();
  expect(toast.success).toHaveBeenCalledWith("Instructions copied.", expect.any(Object));
  expect(screen.getByText(/Installation status is unknown/)).toBeInTheDocument();
});
it("keeps historical selection when another bounded page arrives", async () => {
  api.getAutomationHostPromptHistory
    .mockResolvedValueOnce({ issues: [issue(3), issue(2)], nextCursor: 2 })
    .mockResolvedValueOnce({ issues: [issue(1)], nextCursor: null });
  const user = await open(
    status({
      prompt: { latestIssued: issue(3), currentTemplateVersion: 3, upgradeAvailable: false },
    }),
  );
  await user.selectOptions(await screen.findByLabelText("Saved version"), "2");
  await user.click(screen.getByRole("button", { name: "Load older versions" }));
  await waitFor(() =>
    expect(api.getAutomationHostPromptHistory).toHaveBeenLastCalledWith("schedule-a", {
      limit: 10,
      beforeVersion: 2,
    }),
  );
  expect(screen.getByLabelText("Host prompt")).toHaveValue(issue(2).text);
});
it("issues only explicitly with the current schedule revision and selects returned text", async () => {
  api.issueAutomationHostPrompt.mockResolvedValue(issue(2));
  const user = await open();
  await user.click(screen.getByRole("button", { name: "Save latest instructions" }));
  await waitFor(() => expect(screen.getByLabelText("Host prompt")).toHaveValue(issue(2).text));
  expect(api.issueAutomationHostPrompt).toHaveBeenCalledWith("schedule-a", 2, {
    expectedScheduleVersion: 7,
  });
});
it("retains readable text after stale issue and clipboard failures with toast-only errors", async () => {
  api.issueAutomationHostPrompt.mockRejectedValue(new Error("Reload host status."));
  const user = await open();
  await user.click(screen.getByRole("button", { name: "Save latest instructions" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Reload host status.", expect.any(Object)),
  );
  expect(screen.queryByText("Reload host status.")).not.toBeInTheDocument();
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
  await user.click(screen.getByRole("button", { name: "Copy instructions" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("copied"), expect.any(Object)),
  );
  expect(screen.getByLabelText("Host prompt")).toHaveValue(issue().text);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it.each([
  "revoked",
  "cancelled",
])("retains history but prevents new issuance for %s", async (state) => {
  await open(status({ schedule: { id: "schedule-a", label: "My host", state, version: 7 } }));
  expect(screen.getByLabelText("Host prompt")).toHaveValue(issue().text);
  expect(
    screen.queryByRole("button", { name: "Save latest instructions" }),
  ).not.toBeInTheDocument();
});
it("does not fabricate instructions when metadata is absent", async () => {
  await open(status({ prompt: undefined }));
  expect(screen.getByText(/Saved instructions are unavailable/)).toBeInTheDocument();
  expect(screen.queryByLabelText("Host prompt")).not.toBeInTheDocument();
  expect(api.getAutomationHostPromptHistory).not.toHaveBeenCalled();
});
it("issues missing legacy instructions without inventing a previous version", async () => {
  api.getAutomationHostPromptHistory.mockResolvedValue({ issues: [], nextCursor: null });
  api.issueAutomationHostPrompt.mockResolvedValue(issue(2));
  const user = await open(
    status({ prompt: { latestIssued: null, currentTemplateVersion: 2, upgradeAvailable: false } }),
  );
  expect(screen.queryByLabelText("Host prompt")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Issue instructions" }));
  await waitFor(() => expect(screen.getByLabelText("Host prompt")).toHaveValue(issue(2).text));
});
it("reads and copies another schedule's own saved text", async () => {
  const other = { ...issue(), scheduleId: "schedule-b", text: "Instructions for B only" };
  api.getAutomationHostPromptHistory.mockResolvedValue({ issues: [other], nextCursor: null });
  const user = await open(
    status({
      schedule: { id: "schedule-b", label: "Other host", state: "active", version: 8 },
      prompt: { latestIssued: other, currentTemplateVersion: 1, upgradeAvailable: false },
    }),
  );
  const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  await user.click(screen.getByRole("button", { name: "Copy instructions" }));
  expect(write).toHaveBeenCalledWith(other.text);
  expect(api.getAutomationHostPromptHistory).toHaveBeenCalledWith("schedule-b", { limit: 10 });
});
