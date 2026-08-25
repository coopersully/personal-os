// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { MailReview, MailStatus, MailStewardshipQuestion } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { MailStewardshipPage } from "./stewardship-page.js";

const mocks = vi.hoisted(() => ({
  answerMailQuestion: vi.fn(),
  getMailReview: vi.fn(),
  getMailStatus: vi.fn(),
  maintainMail: vi.fn(),
}));

vi.mock("../../api.js", () => ({
  api: mocks,
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : "Unknown error"),
}));

const now = "2026-08-25T15:00:00.000Z";
const accountId = "11111111-1111-4111-8111-111111111111";
const threadId = "22222222-2222-4222-8222-222222222222";
const question: MailStewardshipQuestion = {
  accountId,
  answer: null,
  answeredAt: null,
  createdAt: now,
  evidence: [
    { accountId, provider: "google", remoteId: "opaque", revision: now, sourceType: "mail_thread" },
  ],
  fingerprint: "a".repeat(64),
  id: "33333333-3333-4333-8333-333333333333",
  kind: "needs_disposition",
  options: [{ label: "Reference only", value: "reference" }],
  reason: "Choose the durable disposition.",
  status: "open",
  threadId,
  updatedAt: now,
  version: 2,
};

const status: MailStatus = {
  activeRun: null,
  asOf: now,
  details: {
    authority: {
      approvedRule: ["apply_approved_rule"],
      automatic: ["inspect", "publish_review"],
      individualApproval: ["activate_rule"],
      unavailable: ["compose_email", "reply_email", "forward_email", "send_email"],
    },
    dispositionCounts: {
      active: 0,
      deferred: 0,
      delegated: 0,
      noise: 0,
      reference: 0,
      resolved: 0,
      waiting: 0,
    },
    effectCounts: { failed: 0, pending: 0, reconcile: 0 },
    health: [
      {
        dimension: "ambiguity",
        evidenceIds: [question.id],
        signal: "attention",
        summary: "One material question remains.",
      },
    ],
    latestReview: {
      createdAt: now,
      evidenceCutoff: now,
      id: "44444444-4444-4444-8444-444444444444",
      ledgerFingerprint: "b".repeat(64),
      state: "maintained_with_questions",
    },
    objective: {
      mode: "default_obligation_integrity",
      profileId: null,
      profileVersion: null,
      summary: "Keep known obligations explicit and current.",
    },
    obligationCounts: { deferred: 0, dismissed: 0, open: 1, resolved: 0, waiting: 0 },
    openQuestionCount: 1,
    openQuestions: [question],
    playbookVersion: "1.0.0",
    rulebookVersion: "mail-rules-v1",
  },
  domain: "mail",
  freshness: { blockers: [], observedAt: now, state: "current" },
  state: "needs_input",
  validNextOperations: [{ href: null, label: "Maintain Mail", operation: "maintain_mail" }],
  work: {
    actionable: 1,
    awaitingApproval: 0,
    awaitingInput: 1,
    blocked: 0,
    oldestOutstandingAt: now,
  },
};

const review: MailReview = {
  createdAt: now,
  effectCounts: { failed: 0, pending: 0, reconcile: 0 },
  evidenceCutoff: now,
  health: status.details.health,
  id: status.details.latestReview?.id as string,
  ledgerFingerprint: "b".repeat(64),
  nextMaintenanceAt: "2026-08-26T15:00:00.000Z",
  obligationCounts: status.details.obligationCounts,
  openQuestionCount: 1,
  playbookVersion: "1.0.0",
  profileVersion: null,
  rulebookVersion: "mail-rules-v1",
  sourceFreshness: "current",
  state: "maintained_with_questions",
};

function renderPage(route = `/mail/review?question=${question.id}`) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { gcTime: 0, retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <main>
          <MailStewardshipPage />
        </main>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Mail workspace stewardship", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => {
      mock.mockReset();
    });
    mocks.getMailStatus.mockResolvedValue(status);
    mocks.getMailReview.mockResolvedValue(review);
    mocks.answerMailQuestion.mockResolvedValue({
      ...question,
      answer: "reference",
      status: "answered",
    });
    mocks.maintainMail.mockResolvedValue({
      run: {
        domain: "mail",
        id: "55555555-5555-4555-8555-555555555555",
        status: "completed_with_questions",
      },
      summary: "One question remains.",
      verification: null,
    });
  });

  it("renders API-owned needs-input state and answers the exact question", async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByRole("heading", { name: "Needs your input" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Reference only" }));
    expect(mocks.answerMailQuestion).toHaveBeenCalledWith(question.id, {
      answer: "reference",
      expectedVersion: 2,
      generalize: false,
    });
    expect(screen.getByText(/Ilo never sends email\./)).toBeVisible();
  });

  it("requests one maintenance turn and never renders a transmission action", async () => {
    const user = userEvent.setup();
    renderPage("/mail/review");
    const button = await screen.findByRole("button", { name: "Maintain Mail" });
    await user.click(button);
    await waitFor(() => expect(mocks.maintainMail).toHaveBeenCalledTimes(1));
    expect(mocks.maintainMail).toHaveBeenCalledWith({ scope: { type: "all_outstanding" } });
    expect(
      screen.queryByRole("button", { name: /compose|reply|forward|send/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the immutable review evidence", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "Immutable review artifact" })).toBeVisible();
    expect(await screen.findByText("mail-rules-v1")).toBeVisible();
    expect(screen.getByText("Published evidence is never rewritten in place.")).toBeVisible();
  });
});
