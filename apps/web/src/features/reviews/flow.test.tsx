// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { ReviewFlowHost } from "./flow.js";

const mocks = vi.hoisted(() => ({
  listAgentAccessWorkItems: vi.fn(),
  listAttentionItems: vi.fn(),
  updateAttentionItem: vi.fn(),
  getMailStatus: vi.fn(),
}));
vi.mock("../../api.js", () => ({
  api: mocks,
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : "Failed"),
}));
const first = {
  id: "attention:one",
  domain: "calendar",
  title: "Protect travel time",
  summary: "Decide whether travel time is needed.",
  preview: [] as Array<{ label: string; value: string }>,
  kind: "attention",
  action: null,
};
const second = { ...first, id: "attention:two", title: "Confirm meeting time" };
let pending = [first, second];
function Location() {
  const location = useLocation();
  return (
    <output aria-label="Location">
      {location.pathname}
      {location.search}
    </output>
  );
}
function setup(path = "/calendar?review=open", workspace: "calendar" | "mail" = "calendar") {
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <MemoryRouter initialEntries={[path]}>
        <ReviewFlowHost workspace={workspace} />
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  pending = [first, second];
  mocks.updateAttentionItem.mockReset();
  mocks.listAgentAccessWorkItems.mockImplementation(async () => ({
    items: pending,
    nextCursor: null,
    unavailableDomains: [],
    summary: { byDomain: { calendar: pending.length } },
  }));
  mocks.listAttentionItems.mockResolvedValue([
    { id: "one", version: 4 },
    { id: "two", version: 2 },
  ]);
});
it("resolves the displayed revision, advances, and keeps the workspace", async () => {
  mocks.updateAttentionItem.mockImplementation(async () => {
    pending = [second];
    return {};
  });
  setup();
  expect(await screen.findByText("Protect travel time")).toBeVisible();
  await userEvent.click(await screen.findByRole("button", { name: "Mark resolved" }));
  expect(await screen.findByText("1 completed · 1 left · 2 total")).toBeVisible();
  expect(screen.getByText("Confirm meeting time")).toBeVisible();
  expect(mocks.updateAttentionItem).toHaveBeenCalledWith("calendar", "one", {
    expectedVersion: 4,
    status: "resolved",
  });
  expect(screen.getByLabelText("Location")).toHaveTextContent("/calendar?review=open");
});
it("Later keeps the item outstanding and sends no mutation", async () => {
  setup();
  await screen.findByText("Protect travel time");
  await userEvent.click(screen.getByRole("button", { name: "Later" }));
  expect(screen.getByText("Confirm meeting time")).toBeVisible();
  expect(screen.getByText("0 completed · 2 left · 2 total")).toBeVisible();
  expect(mocks.updateAttentionItem).not.toHaveBeenCalled();
});
it("keeps the card and progress when saving fails", async () => {
  mocks.updateAttentionItem.mockRejectedValue(new Error("The item changed. Reload it."));
  setup();
  await userEvent.click(await screen.findByRole("button", { name: "Mark resolved" }));
  await waitFor(() => expect(mocks.updateAttentionItem).toHaveBeenCalled());
  expect(screen.getByText("Protect travel time")).toBeVisible();
  expect(screen.getByText("0 completed · 2 left · 2 total")).toBeVisible();
});
it("does not substitute another decision for an unavailable deep link", async () => {
  setup("/calendar?review=attention:missing");
  expect(
    await screen.findByText("This review is no longer available. It may already be resolved."),
  ).toBeVisible();
  expect(screen.queryByText("Protect travel time")).not.toBeInTheDocument();
});

it("does not count a submitted action when the source status is unavailable", async () => {
  mocks.updateAttentionItem.mockImplementation(async () => {
    mocks.listAgentAccessWorkItems.mockResolvedValue({
      items: [],
      nextCursor: null,
      unavailableDomains: ["calendar"],
    });
    return {};
  });
  setup();
  await userEvent.click(await screen.findByRole("button", { name: "Mark resolved" }));
  expect(await screen.findByText(/review status couldn’t be confirmed/)).toBeVisible();
  expect(screen.getByText("Protect travel time")).toBeVisible();
  expect(screen.getByText("0 completed · 2 left · 2 total")).toBeVisible();
});

it("loads the selected attention item directly and refreshes its revision after a conflict", async () => {
  let revision = 4;
  mocks.listAttentionItems.mockImplementation(async (query) =>
    query.id === "one" ? [{ id: "one", version: revision }] : [],
  );
  mocks.updateAttentionItem.mockRejectedValueOnce(new Error("The item changed. Reload it."));
  setup();
  await userEvent.click(await screen.findByRole("button", { name: "Mark resolved" }));
  await waitFor(() => expect(mocks.updateAttentionItem).toHaveBeenCalledOnce());
  revision = 5;
  await userEvent.click(screen.getByRole("button", { name: "Check status" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Check status" })).toBeEnabled());
  await userEvent.click(screen.getByRole("button", { name: "Mark resolved" }));
  expect(mocks.updateAttentionItem).toHaveBeenLastCalledWith("calendar", "one", {
    expectedVersion: 5,
    status: "resolved",
  });
});

it("keeps the reason for a Mail maintenance blocker visible without an answerable question", async () => {
  pending = [
    {
      ...first,
      id: "mail-run:blocked",
      domain: "mail",
      title: "Mail maintenance is blocked",
      preview: [{ label: "What stopped", value: "Reconnect the expired Mail account." }],
    },
  ] as typeof pending;
  mocks.getMailStatus.mockResolvedValue({ details: { openQuestions: [] } });
  setup("/mail?review=open", "mail");
  expect(await screen.findByText("Reconnect the expired Mail account.")).toBeVisible();
});
