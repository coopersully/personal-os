// @vitest-environment jsdom
import type { User } from "@personal-os/domain";
import { resolveWorkspaceSettings } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { api } from "@/api";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WorkspacePreferencesSection } from "../workspace-settings/section";
import { MailPage } from "./mail";

afterEach(() => vi.restoreAllMocks());
it("retains a Mail layout attempt at its contextual control and after navigating to Settings", async () => {
  const owner = { id: "owner", email: "person@example.com", planningTimezone: "UTC" } as User;
  vi.spyOn(api, "listConnectors").mockResolvedValue([
    {
      id: "mail-account",
      label: "Personal Google",
      email: "person@example.com",
      provider: "google",
      mailEnabled: true,
      calendarEnabled: false,
      syncStatus: "idle",
      syncError: null,
      lastSyncedAt: null,
      lastSyncAttemptAt: null,
      nextSyncAt: null,
      health: { message: null, nextSyncAt: null, recovery: null, state: "ready" },
    },
  ]);
  vi.spyOn(api, "listMailboxes").mockResolvedValue([]);
  vi.spyOn(api, "listMailThreads").mockResolvedValue([]);
  vi.spyOn(api, "getMailSetupContext").mockResolvedValue({ accounts: [] } as never);
  const read = vi
    .spyOn(api, "getWorkspaceSettings")
    .mockResolvedValue(resolveWorkspaceSettings("mail"));
  const update = vi.spyOn(api, "updateWorkspaceSettings").mockRejectedValue(new Error("Offline"));
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cache.setQueryData(["me"], owner);
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={cache}>
      <MemoryRouter>
        <TooltipProvider>{children}</TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(<MailPage user={owner} />, { wrapper });
  const user = userEvent.setup();
  const layout = await screen.findByRole("button", { name: "Message list layout" });
  await waitFor(() => expect(layout).toBeEnabled());
  await user.click(layout);
  await user.click(screen.getByRole("menuitemradio", { name: "Full-width view" }));
  expect(await screen.findByText("Your change: Full-width view")).toBeVisible();
  expect(layout).toBeDisabled();
  read.mockResolvedValue(
    resolveWorkspaceSettings("mail", { mailConversationLayout: "split", revision: 3 }),
  );
  await user.click(screen.getByRole("button", { name: "Refresh latest settings" }));
  expect(await screen.findByText("Latest: Split view")).toBeVisible();
  view.unmount();
  render(<WorkspacePreferencesSection workspace="mail" />, { wrapper });
  expect(await screen.findByText("Your change: Full-width view")).toBeVisible();
  expect(screen.getByLabelText("Conversation layout")).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Use latest settings" }));
  await waitFor(() => expect(screen.getByLabelText("Conversation layout")).toBeEnabled());
  expect(update).toHaveBeenCalledTimes(1);
});
