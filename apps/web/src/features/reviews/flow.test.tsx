// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { AgentAccessDomain } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { loadReviewSession, ReviewFlowHost } from "./flow.js";

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
function setup(path = "/calendar?review=open", workspace: AgentAccessDomain = "calendar") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <ReviewFlowHost workspace={workspace} />
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
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

it("can defer every item and resume the unchanged review pass", async () => {
  setup();
  await screen.findByText("Protect travel time");
  await userEvent.click(screen.getByRole("button", { name: "Later" }));
  await userEvent.click(screen.getByRole("button", { name: "Later" }));
  expect(screen.getByText("That’s everything for this pass")).toBeVisible();
  expect(
    screen.getByText("2 items left for later. They’ll be here when you’re ready."),
  ).toBeVisible();
  expect(mocks.updateAttentionItem).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Review remaining" }));
  expect(screen.getByText("Protect travel time")).toBeVisible();
  expect(screen.getByText("0 completed · 2 left · 2 total")).toBeVisible();
});
it("keeps submitted work outstanding when its status refresh fails", async () => {
  mocks.updateAttentionItem.mockImplementation(async () => {
    mocks.listAgentAccessWorkItems.mockRejectedValue(new Error("Status unavailable"));
    return {};
  });
  setup();
  const resolve = await screen.findByRole("button", { name: "Mark resolved" });
  await waitFor(() => expect(resolve).toBeEnabled());
  await userEvent.click(resolve);
  expect(await screen.findByText(/Couldn’t confirm the result/)).toBeVisible();
  expect(screen.getByText("Protect travel time")).toBeVisible();
  expect(screen.getByText("0 completed · 2 left · 2 total")).toBeVisible();
  expect(screen.getByRole("button", { name: "Check status" })).toBeEnabled();
});
it("counts both exact decisions only after their disappearance is confirmed", async () => {
  mocks.updateAttentionItem.mockImplementation(async (_domain, id) => {
    pending = pending.filter((item) => item.id !== `attention:${id}`);
    return {};
  });
  setup();
  for (const title of ["Protect travel time", "Confirm meeting time"]) {
    await screen.findByText(title);
    const resolve = screen.getByRole("button", { name: "Mark resolved" });
    await waitFor(() => expect(resolve).toBeEnabled());
    await userEvent.click(resolve);
  }
  expect(await screen.findByText("You’re caught up")).toBeVisible();
  expect(screen.getByText("2 completed · 0 left · 2 total")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Review remaining" })).not.toBeInTheDocument();
  expect(mocks.updateAttentionItem).toHaveBeenCalledWith("calendar", "two", {
    expectedVersion: 2,
    status: "resolved",
  });
});
it("shows a verified empty session without inventing completed decisions", async () => {
  pending = [];
  setup();
  expect(await screen.findByText("You’re caught up")).toBeVisible();
  expect(screen.getByText("0 completed · 0 left · 0 total")).toBeVisible();
  expect(screen.getByText("0 decisions completed.")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Mark resolved" })).not.toBeInTheDocument();
});
it("distinguishes an unavailable empty session from verified completion", async () => {
  mocks.listAgentAccessWorkItems.mockResolvedValue({
    items: [],
    nextCursor: null,
    unavailableDomains: ["calendar"],
  });
  setup();
  expect(await screen.findByText("Available reviews complete")).toBeVisible();
  expect(screen.getByText(/Some review sources couldn’t be checked/)).toBeVisible();
  expect(screen.getByText("0 completed · 0 left · 0 total (available items)")).toBeVisible();
  expect(screen.queryByText("You’re caught up")).not.toBeInTheDocument();
});

it("loads all review pages and preserves a later unavailable source", async () => {
  mocks.listAgentAccessWorkItems.mockImplementation(async ({ cursor }) =>
    cursor
      ? { items: [second], nextCursor: null, unavailableDomains: ["calendar"] }
      : { items: [first], nextCursor: "next", unavailableDomains: [] },
  );
  await expect(loadReviewSession("calendar")).resolves.toEqual({
    items: [first, second],
    unavailable: true,
  });
  expect(mocks.listAgentAccessWorkItems).toHaveBeenLastCalledWith({
    domain: "calendar",
    limit: 10,
    cursor: "next",
  });
});
it("stops a cancelled paginated session before requesting another page", async () => {
  const controller = new AbortController();
  controller.abort();
  mocks.listAgentAccessWorkItems.mockResolvedValue({
    items: [first],
    nextCursor: "next",
    unavailableDomains: [],
  });
  const calls = mocks.listAgentAccessWorkItems.mock.calls.length;
  await expect(loadReviewSession("calendar", controller.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(mocks.listAgentAccessWorkItems).toHaveBeenCalledTimes(calls + 1);
});
it("does not expose a partial first page as a complete session when the next page fails", async () => {
  mocks.listAgentAccessWorkItems.mockImplementation(async ({ cursor }) => {
    if (cursor) throw new Error("Next page unavailable");
    return { items: [first], nextCursor: "next", unavailableDomains: [] };
  });
  setup();
  expect(await screen.findByText("Couldn’t load your review session.")).toBeVisible();
  expect(screen.queryByText("Protect travel time")).not.toBeInTheDocument();
});

it.each([
  ["attention:one", "Protect travel time"],
  ["attention:two", "Confirm meeting time"],
])("starts an exact review link at %s instead of another queued decision", async (id, title) => {
  setup(`/calendar?review=${id}`);
  expect(await screen.findByText(title)).toBeVisible();
  expect(screen.getByText("0 completed · 2 left · 2 total")).toBeVisible();
  expect(mocks.updateAttentionItem).not.toHaveBeenCalled();
});
it.each([
  "calendar",
  "mail",
  "tasks",
  "finances",
] as const)("refreshes %s workspace evidence after a confirmed action without invalidating other workspaces", async (workspace) => {
  pending = [{ ...first, domain: workspace }];
  mocks.updateAttentionItem.mockImplementation(async () => {
    pending = [];
    return {};
  });
  const client = setup(`/${workspace}?review=open`, workspace);
  const keys = {
    calendar: "calendar-events",
    mail: "mail-status",
    tasks: "task-workspace",
    finances: "finance-overview",
  };
  for (const key of [...Object.values(keys), "events", "me"]) client.setQueryData([key], {});
  const resolve = await screen.findByRole("button", { name: "Mark resolved" });
  await waitFor(() => expect(resolve).toBeEnabled());
  await userEvent.click(resolve);
  await screen.findByText("You’re caught up");
  await waitFor(() => expect(client.getQueryState([keys[workspace]])?.isInvalidated).toBe(true));
  for (const other of ["calendar", "mail", "tasks", "finances"] as const) {
    if (other !== workspace) expect(client.getQueryState([keys[other]])?.isInvalidated).toBe(false);
  }
  expect(client.getQueryState(["events"])?.isInvalidated).toBe(workspace === "calendar");
  expect(client.getQueryState(["me"])?.isInvalidated).toBe(false);
});
