// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { MailResponseBrief, MailThreadStewardship } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ThreadStewardship } from "./thread-stewardship.js";

const mocks = vi.hoisted(() => ({
  answerMailQuestion: vi.fn(),
  createMailObligation: vi.fn(),
  createMailStewardshipFeedback: vi.fn(),
  getMailThreadStewardship: vi.fn(),
  previewMailResponseBrief: vi.fn(),
  setMailDisposition: vi.fn(),
  updateMailObligation: vi.fn(),
}));
vi.mock("../../api.js", () => ({
  api: mocks,
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : "Unknown error"),
}));

const now = "2026-08-25T15:00:00.000Z";
const threadId = "22222222-2222-4222-8222-222222222222";
const stewardship: MailThreadStewardship = {
  disposition: {
    createdAt: now,
    current: true,
    disposition: "active",
    id: "33333333-3333-4333-8333-333333333333",
    rationale: "Explicitly active.",
    sourceThreadRevision: now,
    threadId,
    version: 1,
  },
  obligations: [],
  questions: [
    {
      accountId: "11111111-1111-4111-8111-111111111111",
      answer: null,
      answeredAt: null,
      createdAt: now,
      evidence: [
        {
          accountId: "11111111-1111-4111-8111-111111111111",
          provider: "google",
          remoteId: "opaque",
          revision: now,
          sourceType: "mail_thread",
        },
      ],
      fingerprint: "a".repeat(64),
      id: "44444444-4444-4444-8444-444444444444",
      kind: "needs_disposition",
      options: [{ label: "Reference only", value: "reference" }],
      reason: "Choose a disposition.",
      status: "open",
      threadId,
      updatedAt: now,
      version: 3,
    },
  ],
  threadId,
  threadUpdatedAt: now,
};
const brief: MailResponseBrief = {
  evidence: stewardship.questions[0]?.evidence ?? [],
  factsToAddress: ["Confirm the decision."],
  materialsNeeded: [],
  openQuestions: ["Who owns follow-up?"],
  purpose: "Close the loop",
  sourceThreadRevision: now,
  toneConsiderations: ["Be concise"],
  transmittable: false,
};

function renderThread() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { gcTime: 0, retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ThreadStewardship threadId={threadId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("exact-thread Mail stewardship", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => {
      mock.mockReset();
    });
    mocks.getMailThreadStewardship.mockResolvedValue(stewardship);
    mocks.answerMailQuestion.mockResolvedValue(stewardship.questions[0]);
    mocks.previewMailResponseBrief.mockResolvedValue(brief);
  });

  it("answers only the exact question without implicit generalization", async () => {
    const user = userEvent.setup();
    renderThread();
    await user.click(await screen.findByRole("button", { name: "Reference only" }));
    expect(mocks.answerMailQuestion).toHaveBeenCalledWith(stewardship.questions[0]?.id, {
      answer: "reference",
      expectedVersion: 3,
      generalize: false,
    });
  });

  it("renders a non-transmittable private brief with no delivery action", async () => {
    const user = userEvent.setup();
    renderThread();
    await user.type(await screen.findByLabelText("Purpose"), "Close the loop");
    await user.click(screen.getByRole("button", { name: "Preview private brief" }));
    expect(await screen.findByText("Not transmittable")).toBeVisible();
    expect(screen.getByText("Confirm the decision.")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /compose|reply|forward|send|copy/i }),
    ).not.toBeInTheDocument();
    expect(document.querySelector("a[href^='mailto:']")).toBeNull();
  });

  it("refreshes changed evidence after a revision conflict", async () => {
    const user = userEvent.setup();
    mocks.setMailDisposition.mockRejectedValue(new Error("Revision conflict"));
    renderThread();
    await user.click(await screen.findByRole("button", { name: "Save disposition" }));
    expect(
      await screen.findByText("Evidence changed or the operation could not apply"),
    ).toBeVisible();
    await waitFor(() =>
      expect(mocks.getMailThreadStewardship.mock.calls.length).toBeGreaterThan(1),
    );
  });
});
