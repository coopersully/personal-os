// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { AgentAccessWorkItem } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ReviewActions } from "./review-actions.js";

const mocks = vi.hoisted(() => ({
  previewSavedMailRule: vi.fn(),
  getAssistantSetupStatus: vi.fn(),
  listMailRules: vi.fn(),
  getMailSetupContext: vi.fn(),
  activateMailRule: vi.fn(),
  getMailStatus: vi.fn(),
  maintainMail: vi.fn(),
  getMailReview: vi.fn(),
  getMailQuestion: vi.fn(),
  answerMailQuestion: vi.fn(),
  listAttentionItems: vi.fn(),
  updateAttentionItem: vi.fn(),
}));
vi.mock("../../api.js", () => ({ api: mocks, errorMessage: () => "Failed" }));
beforeEach(() => vi.resetAllMocks());
function setup(id: string, action: AgentAccessWorkItem["action"] = null) {
  const changed = vi.fn(async () => {});
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <ReviewActions
          item={{ id, domain: "mail", action } as AgentAccessWorkItem}
          onChanged={changed}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return changed;
}
it("shows the rule condition and future action even when there are no matching candidates", async () => {
  mocks.previewSavedMailRule.mockResolvedValue({
    candidates: [],
    matchedCount: 0,
    scannedCount: 3,
    ruleVersion: 2,
    fingerprint: "reviewed-fingerprint",
    previewedAt: "2026-07-13T12:00:00.000Z",
    window: { limit: 100 },
  });
  mocks.getAssistantSetupStatus.mockResolvedValue({
    domains: [{ domain: "mail", profileStatus: "active" }],
  });
  mocks.listMailRules.mockResolvedValue([
    {
      id: "rule",
      name: "Newsletter cleanup",
      sourceIds: ["account"],
      condition: { field: "sender", operator: "contains", value: "newsletter.example" },
      actions: [{ type: "trash", afterDays: 7 }],
    },
  ]);
  mocks.getMailSetupContext.mockResolvedValue({
    accounts: [{ accountId: "account", email: "sam@example.com" }],
  });
  mocks.activateMailRule.mockResolvedValue({});
  const changed = setup("mail-rule:rule");
  expect(await screen.findByText(/newsletter\.example/)).toBeVisible();
  expect(screen.getByText(/recoverable Trash after 7 days/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Activate reviewed rule" })).toBeEnabled();
  await userEvent.click(screen.getByRole("button", { name: "Activate reviewed rule" }));
  expect(mocks.activateMailRule).toHaveBeenCalledWith("rule", {
    expectedCandidateIds: [],
    expectedPreviewFingerprint: "reviewed-fingerprint",
    expectedPreviewedAt: "2026-07-13T12:00:00.000Z",
    expectedVersion: 2,
  });
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
});
it("answers the requested Mail question independently of the status endpoint window", async () => {
  mocks.getMailStatus.mockResolvedValue({ details: { openQuestions: [] } });
  mocks.getMailQuestion.mockResolvedValue({
    id: "older",
    status: "open",
    version: 3,
    reason: "Keep this invoice?",
    options: [{ label: "Keep", value: "reference" }],
  });
  mocks.answerMailQuestion.mockResolvedValue({});
  const changed = setup("mail-question:older");
  await userEvent.click(await screen.findByRole("button", { name: "Keep" }));
  expect(mocks.getMailQuestion).toHaveBeenCalledWith("older");
  expect(mocks.answerMailQuestion).toHaveBeenCalledWith("older", {
    answer: "reference",
    expectedVersion: 3,
    generalize: false,
  });
  expect(changed).toHaveBeenCalledOnce();
});

it("responds only to the exact attention item and its current revision", async () => {
  mocks.listAttentionItems.mockResolvedValue([{ id: "older", version: 7 }]);
  mocks.updateAttentionItem.mockResolvedValue({});
  const changed = setup("attention:older");
  const resolve = await screen.findByRole("button", { name: "Mark resolved" });
  await waitFor(() => expect(resolve).toBeEnabled());
  await userEvent.click(resolve);
  expect(mocks.listAttentionItems).toHaveBeenCalledWith({
    domain: "mail",
    id: "older",
    status: "open",
    limit: 1,
  });
  expect(mocks.updateAttentionItem).toHaveBeenCalledWith("mail", "older", {
    expectedVersion: 7,
    status: "resolved",
  });
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
});
it("blocks attention writes when the requested item disappeared", async () => {
  mocks.listAttentionItems.mockResolvedValue([]);
  setup("attention:gone");
  expect(await screen.findByText(/This item is no longer available/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Mark resolved" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Dismiss" })).toBeDisabled();
  expect(mocks.updateAttentionItem).not.toHaveBeenCalled();
});
it("blocks attention writes when its current revision cannot be loaded", async () => {
  mocks.listAttentionItems.mockRejectedValue(new Error("Unavailable"));
  setup("attention:older");
  expect(await screen.findByText("Couldn’t load the current item.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Mark resolved" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Dismiss" })).toBeDisabled();
  expect(mocks.updateAttentionItem).not.toHaveBeenCalled();
});
it("recovers a blocked Mail run without a question and refreshes the review queue once", async () => {
  const status = {
    state: "blocked",
    activeRun: null,
    freshness: { state: "current", observedAt: "2026-08-25T15:00:00.000Z", blockers: [] },
    details: {
      openQuestions: [],
      openQuestionCount: 0,
      latestReview: null,
      objective: { summary: "Keep obligations current", profileVersion: null },
      obligationCounts: { open: 0 },
      effectCounts: { reconcile: 1 },
      health: [],
      authority: {
        automatic: [],
        approvedRule: [],
        individualApproval: [],
        unavailable: ["send_email"],
      },
    },
  };
  mocks.getMailStatus
    .mockResolvedValueOnce(status)
    .mockResolvedValue({ ...status, state: "clean" });
  mocks.maintainMail.mockResolvedValue({
    run: { id: "recovery", status: "completed" },
    summary: "Evidence reconciled.",
  });
  const changed = setup("mail-run:run");
  expect(await screen.findByRole("heading", { name: "Blocked" })).toBeVisible();
  expect(screen.getByText("No unanswered questions.")).toBeVisible();
  expect(screen.getByText("Reconcile effects")).toBeVisible();
  expect(screen.queryByRole("link", { name: "Back to inbox" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Workspace stewardship" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Maintain Mail" }));
  expect(await screen.findByRole("heading", { name: "Clean" })).toBeVisible();
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  expect(mocks.getMailStatus).toHaveBeenCalledTimes(2);
  expect(mocks.maintainMail).toHaveBeenCalledExactlyOnceWith({
    scope: { type: "all_outstanding" },
  });
  expect(mocks.getMailQuestion).not.toHaveBeenCalled();
  expect(mocks.answerMailQuestion).not.toHaveBeenCalled();
});
it("trims a freeform Mail answer and keeps the reviewed version", async () => {
  mocks.getMailQuestion.mockResolvedValue({
    id: "freeform",
    status: "open",
    version: 4,
    reason: "What belongs here?",
    options: [],
  });
  mocks.answerMailQuestion.mockResolvedValue({});
  const changed = setup("mail-question:freeform");
  const answer = await screen.findByRole("textbox", { name: "Your answer" });
  const save = screen.getByRole("button", { name: "Save answer" });
  expect(save).toBeDisabled();
  await userEvent.type(answer, "  Reference  ");
  await userEvent.click(save);
  expect(mocks.answerMailQuestion).toHaveBeenCalledWith("freeform", {
    answer: "Reference",
    expectedVersion: 4,
    generalize: false,
  });
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(answer).toHaveValue("");
});
it("shows bounded rule evidence and activates only the reviewed candidate snapshot", async () => {
  mocks.previewSavedMailRule.mockResolvedValue({
    candidates: [
      {
        id: "conversation",
        subject: "",
        from: { address: "news@example.com" },
        accountId: "missing",
        actions: [
          { type: "mark_read", due: true },
          { type: "trash", afterDays: 7, due: false },
        ],
      },
    ],
    matchedCount: 1,
    scannedCount: 100,
    ruleVersion: 3,
    fingerprint: "bounded-fingerprint",
    previewedAt: "2026-07-13T12:00:00.000Z",
    window: { limit: 100, truncated: true },
  });
  mocks.getAssistantSetupStatus.mockResolvedValue({
    domains: [{ domain: "mail", profileStatus: "active" }],
  });
  mocks.listMailRules.mockResolvedValue([
    {
      id: "bounded",
      name: "Bounded newsletter cleanup",
      sourceIds: ["missing"],
      condition: { field: "sender", operator: "contains", value: "news@example.com" },
      actions: [{ type: "mark_read" }, { type: "trash", afterDays: 7 }],
    },
  ]);
  mocks.getMailSetupContext.mockResolvedValue({
    accounts: [{ accountId: "known", email: null, label: "Archive account" }],
  });
  mocks.activateMailRule.mockResolvedValue({});
  const changed = setup("mail-rule:bounded");
  expect(await screen.findByText(/\(No subject\)/)).toBeVisible();
  expect(screen.getByText(/Rule scope: Unknown account/)).toBeVisible();
  expect(screen.getByText(/more than 100 exist/)).toBeVisible();
  expect(screen.getByText(/mark read immediately; recoverable Trash after 7 days/)).toBeVisible();
  expect(
    screen.getByText(/mark read — due now, recoverable Trash after 7d — retained until due/),
  ).toBeVisible();
  const activate = screen.getByRole("button", { name: "Activate reviewed rule" });
  await waitFor(() => expect(activate).toBeEnabled());
  await userEvent.click(activate);
  expect(mocks.activateMailRule).toHaveBeenCalledWith("bounded", {
    expectedCandidateIds: ["conversation"],
    expectedPreviewFingerprint: "bounded-fingerprint",
    expectedPreviewedAt: "2026-07-13T12:00:00.000Z",
    expectedVersion: 3,
  });
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
});

it("keeps an unfamiliar work item’s explicit destination without inventing mutations", () => {
  setup("proposal:one", { label: "Open proposal", to: "/tasks?task=one" });
  expect(screen.getByRole("link", { name: "Open proposal" })).toHaveAttribute(
    "href",
    "/tasks?task=one",
  );
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(mocks.updateAttentionItem).not.toHaveBeenCalled();
});
it("does not invent an action for an unfamiliar item with no destination", () => {
  setup("proposal:unavailable");
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
it("does not answer an exact Mail question that has already been closed", async () => {
  mocks.getMailQuestion.mockResolvedValue({
    id: "closed",
    status: "answered",
    version: 5,
    reason: "Already decided",
    options: [{ label: "Keep", value: "keep" }],
  });
  setup("mail-question:closed");
  expect(await screen.findByText(/No open question is available/)).toBeVisible();
  expect(screen.queryByRole("button", { name: "Keep" })).not.toBeInTheDocument();
  expect(mocks.answerMailQuestion).not.toHaveBeenCalled();
});
it("exposes a failed exact-question lookup without offering an answer", async () => {
  mocks.getMailQuestion.mockRejectedValue(new Error("Question unavailable"));
  setup("mail-question:failed");
  expect(await screen.findByText("Couldn’t load the Mail question.")).toBeVisible();
  expect(screen.queryByRole("textbox", { name: "Your answer" })).not.toBeInTheDocument();
  expect(mocks.answerMailQuestion).not.toHaveBeenCalled();
});
