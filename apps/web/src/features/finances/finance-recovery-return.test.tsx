// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FinanceRecoveryReturn } from "./finance-recovery-return.js";

it.each([
  "/finances/chat",
  "/finances/chat?question=question-a&message=message-a#source",
])("returns only to the existing Finance conversation %s", (returnTo) => {
  render(
    <MemoryRouter
      initialEntries={[
        `/settings?section=agent-connections&returnTo=${encodeURIComponent(returnTo)}`,
      ]}
    >
      <FinanceRecoveryReturn />
    </MemoryRouter>,
  );
  expect(screen.getByRole("link", { name: "Return to conversation" })).toHaveAttribute(
    "href",
    returnTo,
  );
});

it.each([
  "https://example.com/finances/chat",
  "//example.com/finances/chat",
  "/settings",
  "/finances/chat/../accounts",
  "/finances/chatty",
  "/finances/chat%2f..%2faccounts",
  "/finances/chat?question=a\nb",
  "/finances/chat?question=%0D%0Aevil",
  "/finances/chat?question=%",
  "/finances/chat\\@example.com",
  "/finances/chat?question=%5cevil",
])("rejects an unsafe or malformed conversation return %s", (returnTo) => {
  render(
    <MemoryRouter
      initialEntries={[
        `/settings?section=workspace-access&returnTo=${encodeURIComponent(returnTo)}`,
      ]}
    >
      <FinanceRecoveryReturn />
    </MemoryRouter>,
  );
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});

it("does not add a return action to ordinary settings", () => {
  render(
    <MemoryRouter initialEntries={["/settings?section=agent-connections"]}>
      <FinanceRecoveryReturn />
    </MemoryRouter>,
  );
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});
