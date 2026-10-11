// @vitest-environment jsdom
import { ApiClientError } from "@personal-os/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAppQueryClient } from "../../lib/query-client.js";
import { SettingsFeedbackContext } from "../../lib/settings-feedback";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), dismiss: vi.fn(), success: vi.fn() } }));
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), desktop: true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("./bridge.js", () => ({ isDesktop: () => mocks.desktop }));

import type { UpdateStatus } from "./update-bridge.js";
import { DesktopStartupGate, DesktopUpdates } from "./updates.js";

let status: UpdateStatus;
function mount(child: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SettingsFeedbackContext.Provider value={true}>{child}</SettingsFeedbackContext.Provider>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.mocked(toast.error).mockClear();
  mocks.desktop = true;
  status = {
    installedVersion: "0.1.0",
    availableVersion: null,
    phase: "checking",
    downloadedBytes: 0,
    totalBytes: null,
    checkedAt: null,
    error: null,
    startupBlocking: true,
  };
  mocks.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === "desktop_update_status") return { ...status };
    if (command === "desktop_update_open") status.startupBlocking = false;
  });
});
afterEach(cleanup);
it("never mounts interactive content before startup resolves; escape opens safely", async () => {
  mount(
    <DesktopStartupGate>
      <input aria-label="Your work" />
    </DesktopStartupGate>,
  );
  expect(screen.queryByLabelText("Your work")).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("button", { name: "Open now" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Open now" }));
  expect(await screen.findByLabelText("Your work")).toBeInTheDocument();
  expect(mocks.invoke).toHaveBeenCalledWith("desktop_update_open");
});
it("blocks escape after installation has begun", async () => {
  status.phase = "installing";
  mount(<DesktopStartupGate>Work</DesktopStartupGate>);
  expect(await screen.findByText("Installing update and restarting")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Open now" })).toBeDisabled();
});
it("lets offline or unsupported builds open without an update", async () => {
  status.phase = "error";
  status.startupBlocking = false;
  mount(<DesktopStartupGate>Offline work</DesktopStartupGate>);
  expect(await screen.findByText("Offline work")).toBeInTheDocument();
});
it("does not invoke native commands on the web", () => {
  mocks.desktop = false;
  mount(<DesktopStartupGate>Web app</DesktopStartupGate>);
  expect(screen.getByText("Web app")).toBeInTheDocument();
  expect(mocks.invoke).not.toHaveBeenCalled();
});
it("shows progress and requires confirmation before restart", async () => {
  status = {
    ...status,
    phase: "ready",
    availableVersion: "0.2.0",
    startupBlocking: false,
    checkedAt: "2026-09-30T12:00:00Z",
  };
  mount(<DesktopUpdates />);
  expect(await screen.findByText("nohmi 0.2.0 is ready to install")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Restart to update" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(mocks.invoke).not.toHaveBeenCalledWith("desktop_update_restart");
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Restart to update" }),
  );
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("desktop_update_restart"));
});
it("offers manual check after a failed request", async () => {
  status.phase = "error";
  status.startupBlocking = false;
  status.error = "Could not check for updates";
  mount(<DesktopUpdates />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Check for updates" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("desktop_update_check"));
});
it("shows known byte progress", async () => {
  status.phase = "downloading";
  status.availableVersion = "0.2.0";
  status.totalBytes = 100;
  status.downloadedBytes = 50;
  mount(<DesktopUpdates />);
  expect(await screen.findByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
});
it("reports current and unavailable builds without offering a false update", async () => {
  status.phase = "current";
  status.startupBlocking = false;
  const first = mount(<DesktopUpdates />);
  expect(await screen.findByText("You’re up to date")).toBeInTheDocument();
  first.unmount();
  status.phase = "unavailable";
  mount(<DesktopUpdates />);
  expect(
    await screen.findByText("Automatic updates are unavailable in this build"),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Check for updates" })).toBeDisabled();
});
it("recovers from an unavailable native status without mounting forms early", async () => {
  mocks.invoke.mockRejectedValueOnce(new Error("IPC unavailable"));
  mount(<DesktopStartupGate>Work</DesktopStartupGate>);
  fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Checking for updates")).toBeInTheDocument();
  expect(screen.queryByText("Work")).not.toBeInTheDocument();
});
it("keeps restart confirmation open and reports a ritual restart refusal", async () => {
  status.phase = "ready";
  status.startupBlocking = false;
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "desktop_update_restart")
      throw new Error("Finish or snooze the ritual before restarting");
    return { ...status };
  });
  mount(<DesktopUpdates />);
  fireEvent.click(await screen.findByRole("button", { name: "Restart to update" }));
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Restart to update" }),
  );
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
  expect(
    screen.queryByText("Finish or snooze the ritual before restarting"),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});
it("allows canceling restart without invoking installation", async () => {
  status.phase = "ready";
  mount(<DesktopUpdates />);
  fireEvent.click(await screen.findByRole("button", { name: "Restart to update" }));
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  expect(mocks.invoke).not.toHaveBeenCalledWith("desktop_update_restart");
});
it("supports retrying an unreadable settings status", async () => {
  mocks.invoke.mockRejectedValueOnce(new Error("unavailable"));
  mount(<DesktopUpdates />);
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn’t read desktop update status.",
      expect.objectContaining({ action: expect.anything() }),
    ),
  );
  expect(screen.queryByText(/Could not read update status/)).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  const retry = vi.mocked(toast.error).mock.calls.at(-1)?.[1]?.action;
  if (!retry || !("onClick" in retry)) throw new Error("Expected toast retry action");
  retry.onClick({} as React.MouseEvent<HTMLButtonElement>);
  expect(await screen.findByText("Installed version 0.1.0")).toBeInTheDocument();
});

it("keeps sign-in reachable after the server returns an unauthenticated session", async () => {
  status.startupBlocking = false;
  status.phase = "unavailable";
  const client = createAppQueryClient({ queries: { retry: false } });
  render(
    <QueryClientProvider client={client}>
      <DesktopStartupGate>
        <input aria-label="Sign in email" />
      </DesktopStartupGate>
    </QueryClientProvider>,
  );
  await screen.findByRole("textbox", { name: "Sign in email" });
  await expect(
    client.fetchQuery({
      queryKey: ["me"],
      queryFn: async () => {
        throw new ApiClientError({
          status: 401,
          code: "unauthorized",
          message: "Authentication is required.",
        });
      },
    }),
  ).rejects.toMatchObject({ status: 401 });
  expect(screen.getByRole("textbox", { name: "Sign in email" })).toBeInTheDocument();
  expect(client.getQueryState(["desktop-update-status"])?.status).toBe("success");
  client.clear();
});

it("reports a manual check failure through Sonner without an inline action result", async () => {
  status.phase = "current";
  status.startupBlocking = false;
  mocks.invoke.mockImplementation(async (command) => {
    if (command === "desktop_update_check") throw new Error("private failure");
    return { ...status };
  });
  mount(<DesktopUpdates />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Check for updates" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
  expect(screen.queryByText(/Could not read update status/)).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
