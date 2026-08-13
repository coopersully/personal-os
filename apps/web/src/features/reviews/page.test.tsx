// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { ApiClientError } from "@personal-os/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { ReviewsPage } from "./page.js";

const now = "2026-08-12T12:00:00.000Z";
const mocks = vi.hoisted(() => ({ listAgentAccessWorkItems: vi.fn() }));

vi.mock("../../api.js", () => ({
  api: mocks,
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : "Unknown error"),
}));

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Current location">{`${location.pathname}${location.search}`}</output>;
}

function renderPage(path = "/reviews") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: 0, retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <ReviewsPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Reviews", () => {
  beforeEach(() => {
    mocks.listAgentAccessWorkItems.mockReset();
    mocks.listAgentAccessWorkItems.mockResolvedValue({
      filteredTotal: 1,
      items: [
        {
          action: {
            label: "Review rule",
            to: "/settings?section=workspace-access&workspace=mail",
          },
          actionAt: null,
          domain: "mail",
          id: "mail-rule:one",
          kind: "review",
          priority: "person_review",
          source: null,
          summary: "Review a bounded rule preview.",
          title: "Review newsletters",
          updatedAt: now,
        },
        {
          action: null,
          actionAt: null,
          domain: null,
          id: "legacy-setup-item",
          kind: "attention",
          priority: "person_review",
          source: null,
          summary: "This setup-shaped item does not belong in Reviews.",
          title: "Legacy setup item",
          updatedAt: now,
        },
      ],
      nextCursor: null,
      snapshotAt: now,
      summary: {
        byDomain: { calendar: 0, finances: 0, mail: 1, tasks: 0 },
        byKind: { attention: 0, review: 1 },
        total: 1,
      },
      unavailableDomains: [],
    });
  });

  it("shows only review and attention work and keeps filters in the URL", async () => {
    const browser = userEvent.setup();
    renderPage();

    expect(await screen.findByRole("heading", { name: "Reviews" })).toBeInTheDocument();
    expect(await screen.findByText("Review newsletters")).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Setup" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review rule" })).toHaveAttribute(
      "href",
      "/settings?section=workspace-access&workspace=mail",
    );
    expect(screen.queryByText("Legacy setup item")).not.toBeInTheDocument();

    const callsBeforeEmptySelection = mocks.listAgentAccessWorkItems.mock.calls.length;
    await browser.click(screen.getByRole("radio", { name: "All work" }));
    expect(mocks.listAgentAccessWorkItems).toHaveBeenCalledTimes(callsBeforeEmptySelection);

    await browser.click(screen.getByRole("radio", { name: "Attention" }));
    await waitFor(() =>
      expect(mocks.listAgentAccessWorkItems).toHaveBeenLastCalledWith({
        kind: "attention",
        limit: 10,
      }),
    );
    expect(screen.getByLabelText("Current location")).toHaveTextContent("/reviews?kind=attention");

    await browser.selectOptions(screen.getByLabelText("Filter by workspace"), "calendar");
    await waitFor(() =>
      expect(mocks.listAgentAccessWorkItems).toHaveBeenLastCalledWith({
        domain: "calendar",
        kind: "attention",
        limit: 10,
      }),
    );
    expect(screen.getByLabelText("Current location")).toHaveTextContent(
      "/reviews?kind=attention&workspace=calendar",
    );

    await browser.click(screen.getByRole("radio", { name: "All work" }));
    await waitFor(() =>
      expect(mocks.listAgentAccessWorkItems).toHaveBeenLastCalledWith({
        domain: "calendar",
        limit: 10,
      }),
    );
    await browser.selectOptions(screen.getByLabelText("Filter by workspace"), "all");
    await waitFor(() =>
      expect(mocks.listAgentAccessWorkItems).toHaveBeenLastCalledWith({ limit: 10 }),
    );
    expect(screen.getByLabelText("Current location")).toHaveTextContent("/reviews");
  });

  it("keeps an unavailable workspace honest and allows retry", async () => {
    const browser = userEvent.setup();
    mocks.listAgentAccessWorkItems.mockResolvedValueOnce({
      filteredTotal: null,
      items: [],
      nextCursor: null,
      snapshotAt: now,
      summary: {
        byDomain: { calendar: null, finances: 0, mail: 0, tasks: 0 },
        byKind: { attention: 0, review: 0 },
        total: null,
      },
      unavailableDomains: ["calendar"],
    });
    renderPage();

    expect(await screen.findByText("Some workspaces are unavailable")).toBeInTheDocument();
    expect(screen.getByText("Available work is clear")).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText("Review newsletters")).toBeInTheDocument();

    mocks.listAgentAccessWorkItems.mockRejectedValueOnce(new Error("Queue unavailable"));
    await browser.click(screen.getByRole("radio", { name: "Review" }));
    expect(await screen.findByText("Queue unavailable")).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Review newsletters")).toBeInTheDocument();
  });

  it("uses the server's filtered total when workspace and kind are combined", async () => {
    mocks.listAgentAccessWorkItems.mockResolvedValueOnce({
      filteredTotal: 1,
      items: [
        {
          action: null,
          actionAt: null,
          domain: "mail",
          id: "mail-rule:filtered",
          kind: "review",
          priority: "person_review",
          source: null,
          summary: "Only this combined-filter item counts.",
          title: "Filtered review",
          updatedAt: now,
        },
      ],
      nextCursor: null,
      snapshotAt: now,
      summary: {
        byDomain: { calendar: 0, finances: 0, mail: 9, tasks: 0 },
        byKind: { attention: 8, review: 1 },
        total: 9,
      },
      unavailableDomains: [],
    });
    renderPage("/reviews?kind=review&workspace=mail");

    expect(await screen.findByText("1–1 of 1")).toBeInTheDocument();
  });

  it("paginates without losing its current filters", async () => {
    const browser = userEvent.setup();
    const firstPage = {
      filteredTotal: null,
      items: [
        {
          action: null,
          actionAt: null,
          domain: "mail" as const,
          id: "mail-rule:first",
          kind: "review" as const,
          priority: "person_review" as const,
          source: null,
          summary: "First review page.",
          title: "First review",
          updatedAt: now,
        },
      ],
      nextCursor: "cursor-2",
      snapshotAt: now,
      summary: {
        byDomain: { calendar: 0, finances: 0, mail: null, tasks: 0 },
        byKind: { attention: 0, review: null },
        total: null,
      },
      unavailableDomains: ["mail" as const],
    };
    mocks.listAgentAccessWorkItems
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce({
        ...firstPage,
        items: [
          {
            ...firstPage.items[0],
            id: "mail-rule:second",
            summary: "Second review page.",
            title: "Second review",
          },
        ],
        nextCursor: null,
      })
      .mockResolvedValueOnce(firstPage);

    renderPage();
    expect(await screen.findByText("First review")).toBeInTheDocument();
    expect(screen.getByText("1–1")).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByText("Second review")).toBeInTheDocument();
    expect(mocks.listAgentAccessWorkItems).toHaveBeenLastCalledWith({
      cursor: "cursor-2",
      limit: 10,
    });
    expect(screen.getByText("11–11")).toBeInTheDocument();

    await browser.click(screen.getByRole("button", { name: "Previous page" }));
    expect(await screen.findByText("First review")).toBeInTheDocument();
  });

  it("returns to the first page when a cursor expires", async () => {
    const browser = userEvent.setup();
    const firstPage = {
      filteredTotal: 2,
      items: [
        {
          action: null,
          actionAt: null,
          domain: "mail" as const,
          id: "mail-rule:first",
          kind: "review" as const,
          priority: "person_review" as const,
          source: null,
          summary: "First review page.",
          title: "First review",
          updatedAt: now,
        },
      ],
      nextCursor: "cursor-2",
      snapshotAt: now,
      summary: {
        byDomain: { calendar: 0, finances: 0, mail: 2, tasks: 0 },
        byKind: { attention: 0, review: 2 },
        total: 2,
      },
      unavailableDomains: [],
    };
    mocks.listAgentAccessWorkItems
      .mockResolvedValueOnce(firstPage)
      .mockRejectedValueOnce(
        new ApiClientError({
          code: "invalid_request",
          message: "The Agent Access cursor has expired.",
          status: 400,
        }),
      )
      .mockResolvedValueOnce(firstPage);

    renderPage();
    expect(await screen.findByText("First review")).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByText("The Agent Access cursor has expired.")).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() =>
      expect(mocks.listAgentAccessWorkItems).toHaveBeenLastCalledWith({ limit: 10 }),
    );
    expect(await screen.findByText("First review")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
  });

  it("names partial and fully available empty queues clearly", async () => {
    const emptyQueue = {
      filteredTotal: 0,
      items: [],
      nextCursor: null,
      snapshotAt: now,
      summary: {
        byDomain: { calendar: 0, finances: 0, mail: 0, tasks: 0 },
        byKind: { attention: 0, review: 0 },
        total: 0,
      },
      unavailableDomains: ["calendar" as const, "mail" as const],
    };
    mocks.listAgentAccessWorkItems.mockResolvedValueOnce(emptyQueue);
    const twoUnavailable = renderPage();
    expect(await screen.findByText(/Calendar and Mail could not be checked/)).toBeInTheDocument();
    twoUnavailable.unmount();

    mocks.listAgentAccessWorkItems.mockResolvedValueOnce({
      ...emptyQueue,
      unavailableDomains: ["calendar" as const, "mail" as const, "tasks" as const],
    });
    const threeUnavailable = renderPage();
    expect(
      await screen.findByText(/Calendar, Mail, and Tasks could not be checked/),
    ).toBeInTheDocument();
    threeUnavailable.unmount();

    mocks.listAgentAccessWorkItems.mockResolvedValueOnce({
      ...emptyQueue,
      unavailableDomains: [],
    });
    renderPage();
    expect(await screen.findByText("You’re caught up")).toBeInTheDocument();
  });
});
