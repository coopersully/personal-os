// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { AgentAccessWorkItemPage } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AgentAccessQueue } from "./agent-access-queue.js";

const now = "2026-08-11T16:00:00.000Z";

const mocks = vi.hoisted(() => ({
  listAgentAccessWorkItems: vi.fn(),
}));

vi.mock("../../api.js", () => ({
  api: mocks,
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : "Try again."),
}));

function page(overrides: Partial<AgentAccessWorkItemPage> = {}): AgentAccessWorkItemPage {
  return {
    items: [],
    nextCursor: null,
    snapshotAt: now,
    summary: {
      byDomain: { calendar: 0, finances: 0, mail: 0, tasks: 0 },
      byKind: { attention: 0, review: 0, setup: 0 },
      total: 0,
    },
    unavailableDomains: [],
    ...overrides,
  };
}

function workItem(
  index: number,
  domain: "calendar" | "finances" | "mail" | "tasks" | null = "mail",
) {
  return {
    action: { label: "Review", to: "/mail?reviewRule=rule-1" },
    actionAt: now,
    domain,
    id: `work-${index}`,
    kind: "review" as const,
    priority: "person_review" as const,
    source: domain
      ? {
          accountId: null,
          provider: "google" as const,
          remoteId: `source-${index}`,
          revision: null,
          sourceType: "local" as const,
        }
      : null,
    summary: "Confirm what the agent should do next.",
    title: domain ? `Review workspace item ${index}` : "Connect an agent",
    updatedAt: now,
  };
}

function renderQueue() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: 0, retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AgentAccessQueue />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AgentAccessQueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves queue geometry while the first page loads", () => {
    mocks.listAgentAccessWorkItems.mockReturnValue(new Promise(() => undefined));

    const { container } = renderQueue();

    expect(screen.getByRole("heading", { name: "Your action queue" })).toBeInTheDocument();
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(9);
  });

  it("shows a truthful caught-up state when every workspace is available", async () => {
    mocks.listAgentAccessWorkItems.mockResolvedValue(page());

    renderQueue();

    expect(await screen.findByText("You’re caught up")).toBeInTheDocument();
    expect(
      screen.getByText("Nothing needs your review or attention right now."),
    ).toBeInTheDocument();
  });

  it("names unavailable workspaces without presenting a false zero state", async () => {
    mocks.listAgentAccessWorkItems.mockResolvedValue(
      page({
        summary: {
          byDomain: { calendar: null, finances: 0, mail: null, tasks: 0 },
          byKind: { attention: null, review: null, setup: 0 },
          total: null,
        },
        unavailableDomains: ["calendar", "mail"],
      }),
    );

    renderQueue();

    expect(await screen.findByText("Some workspaces are unavailable")).toBeInTheDocument();
    expect(screen.getByText(/Calendar and Mail could not be checked/)).toBeInTheDocument();
    expect(screen.getByText("Available work is clear")).toBeInTheDocument();
    expect(screen.queryByText("You’re caught up")).not.toBeInTheDocument();
  });

  it("filters by kind and resets pagination", async () => {
    const first = page({
      items: Array.from({ length: 10 }, (_, index) => workItem(index + 1)),
      nextCursor: "page-2",
      summary: {
        byDomain: { calendar: 0, finances: 0, mail: 12, tasks: 0 },
        byKind: { attention: 0, review: 12, setup: 0 },
        total: 12,
      },
    });
    mocks.listAgentAccessWorkItems.mockImplementation(async ({ kind }: { kind?: string }) =>
      kind === "attention"
        ? page({
            items: [
              { ...workItem(21), kind: "attention", title: "Reconnect Calendar" },
              { ...workItem(22), kind: "attention", title: "Review Task reminder" },
            ],
            summary: {
              byDomain: { calendar: 1, finances: 0, mail: 12, tasks: 1 },
              byKind: { attention: 2, review: 12, setup: 0 },
              total: 14,
            },
          })
        : first,
    );
    const user = userEvent.setup();
    renderQueue();

    await user.click(await screen.findByRole("button", { name: "Next page" }));
    await waitFor(() =>
      expect(mocks.listAgentAccessWorkItems).toHaveBeenLastCalledWith({
        cursor: "page-2",
        limit: 10,
      }),
    );

    await user.click(screen.getByRole("radio", { name: "Attention" }));

    await waitFor(() =>
      expect(mocks.listAgentAccessWorkItems).toHaveBeenLastCalledWith({
        kind: "attention",
        limit: 10,
      }),
    );
    expect(screen.getByRole("radio", { name: "Attention" })).toHaveAttribute("data-state", "on");
    expect(screen.getByText("1–2 of 2")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your action queue" })).toHaveFocus();
  });

  it("moves forward and backward using opaque cursors", async () => {
    mocks.listAgentAccessWorkItems.mockImplementation(async ({ cursor }: { cursor?: string }) =>
      cursor
        ? page({
            items: [workItem(11)],
            summary: {
              byDomain: { calendar: 0, finances: 0, mail: 11, tasks: 0 },
              byKind: { attention: 0, review: 11, setup: 0 },
              total: 11,
            },
          })
        : page({
            items: Array.from({ length: 10 }, (_, index) => workItem(index + 1)),
            nextCursor: "page-2",
            summary: {
              byDomain: { calendar: 0, finances: 0, mail: 11, tasks: 0 },
              byKind: { attention: 0, review: 11, setup: 0 },
              total: 11,
            },
          }),
    );
    const user = userEvent.setup();
    renderQueue();

    await user.click(await screen.findByRole("button", { name: "Next page" }));
    expect(await screen.findByText("11–11 of 11")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Previous page" }));
    await waitFor(() =>
      expect(mocks.listAgentAccessWorkItems).toHaveBeenLastCalledWith({ limit: 10 }),
    );
    expect(await screen.findByText("1–10 of 11")).toBeInTheDocument();
  });

  it("shows workspace context, one action, and a functional icon for account setup", async () => {
    mocks.listAgentAccessWorkItems.mockResolvedValue(
      page({
        items: [workItem(1), workItem(2, null)],
        summary: {
          byDomain: { calendar: 0, finances: 0, mail: 1, tasks: 0 },
          byKind: { attention: 0, review: 2, setup: 0 },
          total: 2,
        },
      }),
    );

    const { container } = renderQueue();

    const queue = await screen.findByRole("list", { name: "Agent Access action queue" });
    const rows = within(queue).getAllByRole("listitem");
    expect(within(rows[0] as HTMLElement).getByText("Mail")).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getAllByText("Review")).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getAllByRole("link")).toHaveLength(1);
    expect(within(rows[1] as HTMLElement).getByText("Agent access")).toBeInTheDocument();
    expect(container.querySelector('[data-workspace="mail"]')).toBeInTheDocument();
    expect(rows[1]?.querySelector('[data-functional-icon="agent-access"]')).toBeInTheDocument();
    expect(screen.getByText("1–2 of 2")).toBeInTheDocument();
  });
});
