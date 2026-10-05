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
  getMailQuestion: vi.fn(),
  answerMailQuestion: vi.fn(),
  listAttentionItems: vi.fn(),
  updateAttentionItem: vi.fn(),
}));
vi.mock("../../api.js", () => ({ api: mocks, errorMessage: () => "Failed" }));
beforeEach(() => vi.resetAllMocks());
function setup(id: string) {
  const changed = vi.fn(async () => {});
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <ReviewActions item={{ id, domain: "mail" } as AgentAccessWorkItem} onChanged={changed} />
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
it("keeps an empty Mail run blocker honest without inventing a question", async () => {
  mocks.getMailStatus.mockResolvedValue({ details: { openQuestions: [] } });
  setup("mail-run:run");
  expect(await screen.findByText(/No open question is available/)).toBeVisible();
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
