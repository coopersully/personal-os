// @vitest-environment jsdom
import type { AuditEvent } from "@personal-os/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ActivityPage } from "./page";

const mocks = vi.hoisted(() => ({ activity: vi.fn() }));
vi.mock("../../api.js", () => ({ api: { listActivity: mocks.activity } }));
const event = (index: number, extra: Partial<AuditEvent> = {}) =>
  ({
    id: `event-${index}`,
    requestId: `request-${index}`,
    actorType: "user",
    actorId: "owner",
    action: `profile.changed_${index}`,
    entityType: "user",
    entityId: `user-${index}`,
    before: { displayName: "Before", updatedAt: "old" },
    after: { displayName: `After ${index}`, updatedAt: "new" },
    createdAt: new Date(Date.UTC(2026, 9, 22, 12, index)).toISOString(),
    ...extra,
  }) as AuditEvent;
function mount() {
  return render(
    <MemoryRouter initialEntries={["/settings?page=activity"]}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ActivityPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
beforeEach(() => {
  mocks.activity.mockReset();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("paginates grouped records, sorts them, and clears a no-match search without losing navigation", async () => {
  const user = userEvent.setup();
  mocks.activity.mockResolvedValue(Array.from({ length: 12 }, (_, index) => event(index)));
  mount();
  expect(await screen.findByText("1–10 of 12 records")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("11–12 of 12 records")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Previous" }));
  await user.click(screen.getByRole("button", { name: "Sort: Newest First" }));
  await user.click(screen.getByRole("menuitemradio", { name: "Oldest First" }));
  const row = screen.getAllByRole("button", { name: /^Profile · changed/ })[0]!;
  expect(row).toHaveTextContent("changed 0");
  await user.type(screen.getByRole("searchbox", { name: "Search activity" }), "no matches");
  expect(await screen.findByText("No matching activity")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Show all activity" }));
  expect(await screen.findByText("1–10 of 12 records")).toBeInTheDocument();
  expect(screen.getByRole("searchbox", { name: "Search activity" })).toHaveValue("");
});
it("groups one operation and exposes concise field changes plus full recorded values in its dialog", async () => {
  const user = userEvent.setup();
  mocks.activity.mockResolvedValue([
    event(0, { before: null, after: { displayName: "Alex" } }),
    event(1, {
      requestId: "request-0",
      action: "profile.changed_0",
      before: { updatedAt: "old" },
      after: { updatedAt: "new" },
    }),
    event(2, {
      requestId: "request-0",
      action: "profile.changed_0",
      before: {},
      after: null,
    }),
  ]);
  mount();
  const opener = await screen.findByRole("button", { name: /^Profile · changed 0/ });
  await user.click(opener);
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText(/You · 3 changes/)).toBeInTheDocument();
  expect(within(dialog).getByText("Changed: display name")).toBeInTheDocument();
  expect(within(dialog).getAllByText("No field-level changes recorded.")).toHaveLength(2);
  await user.click(within(dialog).getAllByText("Recorded values")[0]!);
  expect(within(dialog).getByText('"Alex"', { exact: false })).toBeVisible();
  await user.click(within(dialog).getByRole("button", { name: "Done" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: /^Profile · changed 0/ })).toBeInTheDocument();
});
it("keeps mobile activity identities readable and filters bounded provider records", async () => {
  vi.stubGlobal("innerWidth", 375);
  const user = userEvent.setup();
  mocks.activity.mockResolvedValue(
    Array.from({ length: 100 }, (_, index) =>
      event(index, { actorType: index % 2 ? "connector" : "agent" }),
    ),
  );
  mount();
  expect(
    await screen.findByText("Latest 100 changes; search and filters apply to these changes."),
  ).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Filters" }));
  const filters = screen.getByRole("dialog", { name: "Filters" });
  within(filters).getByRole("button", { name: "Changed by: Anyone" }).focus();
  await user.keyboard("{ArrowDown}");
  fireEvent.click(screen.getByRole("menuitemradio", { name: "Connectors" }));
  fireEvent.click(within(filters).getByRole("button", { name: "Done" }));
  expect(await screen.findByText("1–10 of 50 records")).toBeInTheDocument();
  expect(screen.getAllByText("Connector")).toHaveLength(10);
});
