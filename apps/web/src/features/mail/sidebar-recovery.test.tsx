// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { MailSidebar } from "./mail";

const api = vi.hoisted(() => ({ listConnectors: vi.fn(), listMailboxes: vi.fn() }));
vi.mock("../../api.js", () => ({ api }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), dismiss: vi.fn() } }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("retries missing mailboxes even while retained accounts have a failed refresh", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["connectors"], []);
  api.listConnectors.mockRejectedValue(new Error("accounts offline"));
  api.listMailboxes.mockRejectedValueOnce(new Error("mailboxes offline")).mockResolvedValue([]);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MailSidebar onNavigate={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Couldn’t load mailboxes.", expect.any(Object)),
  );
  expect(client.getQueryState(["connectors"])?.status).toBe("error");
  const nav = screen.getByRole("navigation", { name: "Mailboxes" });
  expect(nav).not.toHaveTextContent(/Couldn’t/);
  expect(nav.querySelector('[data-slot="empty"]')).toBeNull();
  const action = vi
    .mocked(toast.error)
    .mock.calls.find(([message]) => message === "Couldn’t load mailboxes.")?.[1]?.action;
  if (!action || typeof action !== "object" || !("onClick" in action))
    throw new Error("Missing mailbox retry");
  render(
    <button type="button" onClick={action.onClick}>
      Retry missing mailboxes
    </button>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry missing mailboxes" }));
  await waitFor(() => expect(api.listMailboxes).toHaveBeenCalledTimes(2));
  expect(api.listConnectors).toHaveBeenCalledOnce();
  expect(await screen.findByText(/Connect a mailbox in Settings/)).toBeInTheDocument();
});
