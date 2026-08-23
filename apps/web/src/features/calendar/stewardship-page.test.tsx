// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { CalendarReview, CalendarStatus } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { CalendarStewardshipPage } from "./stewardship-page.js";

const mocks = vi.hoisted(() => ({
  createCalendarReview: vi.fn(),
  getCalendarStatus: vi.fn(),
}));

vi.mock("../../api.js", () => ({
  api: mocks,
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : "Unknown error"),
}));

const now = "2026-08-23T15:00:00.000Z";
const later = "2026-08-24T15:00:00.000Z";
const fingerprint = "a".repeat(64);

const review: CalendarReview = {
  createdAt: now,
  evidenceCutoff: now,
  findings: [
    {
      evidence: {
        endsAt: "2026-08-25T16:00:00.000Z",
        eventIds: ["event-1", "event-2"],
        minutes: 30,
        revisions: ["rev-1", "rev-2"],
        startsAt: "2026-08-25T15:30:00.000Z",
        type: "event_pair",
      },
      evidenceCutoff: now,
      fingerprint,
      firstObservedAt: now,
      id: "finding-1",
      kind: "event_overlap",
      lastObservedAt: now,
      playbookVersion: "1.0.0",
      resolvedAt: null,
      rulebookVersion: "calendar-foundations-v1",
      severity: "attention",
      sourceReferences: [],
      status: "open",
      summary: "Busy events overlap",
    },
  ],
  health: [
    {
      dimension: "source_trust",
      evidenceFindingIds: [],
      signal: "healthy",
      summary: "Source evidence is current and complete.",
    },
    {
      dimension: "hard_conflicts",
      evidenceFindingIds: ["finding-1"],
      signal: "attention",
      summary: "One overlap needs review.",
    },
  ],
  id: "review-1",
  ledgerFingerprint: fingerprint,
  nextMaintenanceAt: later,
  playbookVersion: "1.0.0",
  profileVersion: 1,
  recommendations: [
    {
      assumptions: ["Both events remain busy."],
      confidence: "medium",
      findingIds: ["finding-1"],
      horizon: { end: later, start: now },
      key: "review-overlap",
      summary: "Review which commitment should keep this time.",
      tradeoffs: ["Changing either event may affect another person."],
    },
  ],
  rulebookVersion: "calendar-foundations-v1",
  scope: { type: "all_outstanding" },
  scopeEnd: "2026-11-21T15:00:00.000Z",
  scopeStart: "2026-07-24T15:00:00.000Z",
  sourceFreshness: [
    {
      accountId: "account-1",
      calendarId: "calendar-1",
      completeness: "complete",
      evidenceCutoff: now,
      lastSyncedAt: now,
      provider: "google",
      readable: true,
      reason: null,
      recovery: null,
      state: "current",
      writable: true,
    },
  ],
  state: "maintained_with_questions",
};

const maintainedStatus: CalendarStatus = {
  asOf: now,
  authority: {
    approvedRule: [],
    automatic: ["inspect", "assess"],
    individualApproval: ["create_event", "move_event"],
    unavailable: ["book_travel", "send_correspondence"],
  },
  backlog: {
    actionable: 1,
    ambiguousEffects: 0,
    awaitingApproval: 0,
    awaitingInput: 0,
    blocked: 0,
    failed: 0,
    openFindings: 1,
  },
  health: review.health,
  latestReview: review,
  lifecycle: "maintained_with_questions",
  readiness: "ready",
  setupBlockers: [],
  sources: review.sourceFreshness,
  validNextOperations: ["assess_calendar", "review_findings"],
};

const neverMaintainedStatus: CalendarStatus = {
  ...maintainedStatus,
  backlog: { ...maintainedStatus.backlog, actionable: null, openFindings: null },
  health: [],
  latestReview: null,
  lifecycle: "never_maintained",
};

const blockedStatus: CalendarStatus = {
  ...neverMaintainedStatus,
  backlog: { ...neverMaintainedStatus.backlog, blocked: 1 },
  health: [
    {
      dimension: "source_trust",
      evidenceFindingIds: [],
      signal: "unknown",
      summary: "The source cannot be assessed.",
    },
  ],
  lifecycle: "blocked",
  readiness: "degraded",
  sources: [
    {
      ...review.sourceFreshness[0]!,
      completeness: "unknown",
      reason: "Google access needs to be renewed.",
      recovery: "reconnect",
      state: "unavailable",
    },
  ],
  validNextOperations: ["assess_calendar", "open_connections"],
};

const staleStatus: CalendarStatus = { ...maintainedStatus, lifecycle: "stale" };

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { gcTime: 0, retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <main id="main-content">
          <CalendarStewardshipPage />
        </main>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Calendar schedule health", () => {
  beforeEach(() => {
    mocks.createCalendarReview.mockReset();
    mocks.getCalendarStatus.mockReset();
  });

  it("keeps the application shell as the sole main landmark", async () => {
    mocks.getCalendarStatus.mockResolvedValue(maintainedStatus);
    renderPage();

    expect(await screen.findByRole("heading", { name: "Schedule health" })).toBeInTheDocument();
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });

  it("does not add a main landmark while schedule health is loading", () => {
    mocks.getCalendarStatus.mockReturnValue(new Promise(() => undefined));
    renderPage();

    expect(screen.getByLabelText("Loading schedule health")).toBeInTheDocument();
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });

  it("explains first assessment and refreshes to the durable review", async () => {
    const browser = userEvent.setup();
    mocks.getCalendarStatus
      .mockResolvedValueOnce(neverMaintainedStatus)
      .mockResolvedValueOnce(maintainedStatus);
    mocks.createCalendarReview.mockResolvedValue(review);
    renderPage();

    expect(await screen.findByText("Calendar has not been assessed yet")).toBeInTheDocument();
    expect(screen.getByText(/30 days behind and 90 days ahead/)).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Assess calendar" }));
    await waitFor(() => expect(mocks.createCalendarReview).toHaveBeenCalledWith());
    expect(await screen.findByText("Busy events overlap")).toBeInTheDocument();
    expect(screen.getByText("Evidence through", { selector: "dt" })).toBeInTheDocument();
    expect(screen.getByText("Recommendations are advisory.")).toBeInTheDocument();
    expect(screen.getByText("Healthy")).toBeInTheDocument();
  });

  it("keeps operator-owned recovery as a service constraint", async () => {
    mocks.getCalendarStatus.mockResolvedValue({
      ...blockedStatus,
      sources: [{ ...blockedStatus.sources[0]!, recovery: "operator" }],
      validNextOperations: ["assess_calendar"],
    });
    renderPage();

    expect(
      await screen.findByText(
        "Ilo will keep retrying while its service operator resolves this constraint.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open Connections" })).not.toBeInTheDocument();
  });

  it("preserves immutable prior findings when the current count is unknown", async () => {
    mocks.getCalendarStatus.mockResolvedValue({
      ...staleStatus,
      backlog: { ...staleStatus.backlog, actionable: null, openFindings: null },
    });
    renderPage();

    expect(await screen.findByText("Current finding count is unknown")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Prior review findings" })).toBeInTheDocument();
    expect(screen.getByText("Busy events overlap")).toBeInTheDocument();
    expect(screen.getByText(/does not establish the current finding count/)).toBeInTheDocument();
  });

  it("shows blocked evidence and the first-party recovery path without a false zero", async () => {
    mocks.getCalendarStatus.mockResolvedValue(blockedStatus);
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Source evidence needs attention" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Google access needs to be renewed.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Connections" })).toHaveAttribute(
      "href",
      "/settings?section=connections",
    );
    expect(screen.queryByText(/No findings/)).not.toBeInTheDocument();
    expect(screen.getByText("Unknown until source evidence is current")).toBeInTheDocument();
  });

  it("shows an authoritative zero only within the supported checks", async () => {
    mocks.getCalendarStatus.mockResolvedValue({
      ...maintainedStatus,
      backlog: { ...maintainedStatus.backlog, actionable: 0, openFindings: 0 },
      latestReview: { ...review, findings: [], recommendations: [], state: "maintained" },
      lifecycle: "maintained",
    });
    renderPage();

    expect(await screen.findByText("No findings in the supported checks")).toBeInTheDocument();
    expect(
      screen.getByText(/Travel, protected time, load, recovery, and volatility/),
    ).toBeInTheDocument();
  });

  it("shows stale review state and recovers from read and mutation errors", async () => {
    const browser = userEvent.setup();
    mocks.getCalendarStatus
      .mockRejectedValueOnce(new Error("Status unavailable"))
      .mockResolvedValueOnce(staleStatus);
    mocks.createCalendarReview.mockRejectedValueOnce(new Error("Assessment unavailable"));
    renderPage();

    expect(await screen.findByText("Status unavailable")).toBeInTheDocument();
    expect(screen.getAllByRole("main")).toHaveLength(1);
    await browser.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("This review is stale")).toBeInTheDocument();
    expect(screen.getByText("Busy events overlap")).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Assess calendar" }));
    expect(
      await screen.findByText("Assessment unavailable", {
        selector: '[data-slot="alert-title"]',
      }),
    ).toBeInTheDocument();
  });
});
