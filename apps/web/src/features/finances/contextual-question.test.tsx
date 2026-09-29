// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { AddTransactionContext } from "./contextual-question.js";
import { FinanceReviewPage } from "./review-page.js";

const api = vi.hoisted(() => ({
  createFinanceContextualQuestion: vi.fn(),
  getFinanceContextualQuestion: vi.fn(),
  answerFinanceContextualQuestion: vi.fn(),
  getFinanceInbox: vi.fn(),
}));
vi.mock("../../api.js", () => ({ api, errorMessage: (e: Error) => e.message }));
const id = "11111111-1111-4111-8111-111111111111";
const question = {
  id,
  reviewCaseId: "22222222-2222-4222-8222-222222222222",
  transactionId: id,
  prompt: "What was this transaction for?",
  disclosure: "minimal",
  status: "open",
  work: {
    domain: "finances",
    kind: "question",
    id,
    revision: "9007199254740993",
    actionRevision: "1",
  },
  transaction: { merchant: "Lunch", date: "2026-09-21", amountCents: 1200, currencyCode: "USD" },
};
function show() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[`/finances/review?contextualQuestion=${id}`]}>
        <FinanceReviewPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  api.getFinanceContextualQuestion.mockResolvedValue({ state: "available", question });
});
it("answers the exact canonical work, preserves retry identity, and states the financial case remains open", async () => {
  api.answerFinanceContextualQuestion
    .mockRejectedValueOnce(new Error("Try again"))
    .mockResolvedValue({ state: "accepted" });
  show();
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText(question.prompt), "Lunch with a friend");
  await user.click(screen.getByRole("button", { name: "Save context" }));
  await screen.findByText("Try again");
  await user.click(screen.getByRole("button", { name: "Save context" }));
  await screen.findByText(/Context saved/);
  expect(api.answerFinanceContextualQuestion.mock.calls[0]).toEqual(
    api.answerFinanceContextualQuestion.mock.calls[1],
  );
  expect(api.answerFinanceContextualQuestion).toHaveBeenCalledWith(
    expect.objectContaining({
      work: question.work,
      text: "Lunch with a friend",
      source: { kind: "app", messageId: null },
    }),
  );
  expect(screen.getByText(/financial review remains open/)).toBeVisible();
  expect(api.getFinanceInbox).not.toHaveBeenCalled();
});
it("makes stale work read-only", async () => {
  api.getFinanceContextualQuestion.mockResolvedValue({
    state: "available",
    question: { ...question, status: "stale" },
  });
  show();
  await screen.findByText(/transaction changed/);
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  await waitFor(() => expect(api.answerFinanceContextualQuestion).not.toHaveBeenCalled());
});

it("creates from the transaction action and opens the exact question after a safe retry", async () => {
  api.createFinanceContextualQuestion
    .mockRejectedValueOnce(new Error("Retry creation"))
    .mockResolvedValue({ state: "available", question });
  function Location() {
    return <p>{useLocation().search}</p>;
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <AddTransactionContext transactionId={id} />
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Add context" }));
  await screen.findByText("Retry creation");
  await user.click(screen.getByRole("button", { name: "Add context" }));
  await screen.findByText(`?contextualQuestion=${id}`);
  expect(api.createFinanceContextualQuestion.mock.calls[0]).toEqual(
    api.createFinanceContextualQuestion.mock.calls[1],
  );
});

it("links the contextual financial case to the legacy review destination", async () => {
  show();
  expect(await screen.findByRole("link", { name: "View financial review" })).toHaveAttribute(
    "href",
    `/finances/review/legacy?item=${question.reviewCaseId}`,
  );
});
