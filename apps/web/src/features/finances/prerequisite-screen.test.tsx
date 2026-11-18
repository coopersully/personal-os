// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { FinancePrerequisiteScreen } from "./prerequisite-screen";

it.each([
  ["/finances/chat?question=original#answer", "/finances/setup", "?"],
  ["/finances?view=review", "/finances/setup?step=source", "&"],
  ["/finances", "/finances/setup", "?"],
  ["https://outside.example/finances", "/finances/setup", "?"],
  ["//outside.example/finances", "/finances/setup", "?"],
  ["/finances-other", "/finances/setup", "?"],
])("keeps recovery return local for %s", (returnTo, href, separator) => {
  render(
    <MemoryRouter>
      <FinancePrerequisiteScreen
        title="Complete setup"
        readiness={{
          state: "unavailable",
          reason: "A source is needed",
          action: "Choose source",
          href,
        }}
        returnTo={returnTo}
      />
    </MemoryRouter>,
  );
  const safe =
    returnTo === "/finances" ||
    returnTo.startsWith("/finances?") ||
    returnTo.startsWith("/finances/")
      ? returnTo
      : "/finances";
  expect(screen.getByRole("link", { name: "Choose source" })).toHaveAttribute(
    "href",
    `${href}${separator}returnTo=${encodeURIComponent(safe)}`,
  );
  expect(screen.getByText("A source is needed")).toBeInTheDocument();
});
it("retries unavailable readiness without fabricating a recovery link", async () => {
  const retry = vi.fn();
  render(
    <MemoryRouter>
      <FinancePrerequisiteScreen
        title="Try again"
        readiness={{ state: "unavailable", reason: "Unavailable", action: null, href: null }}
        returnTo="/finances"
        retry={retry}
      />
    </MemoryRouter>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(retry).toHaveBeenCalledOnce();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});
it("shows the reason without an action when recovery is unavailable", () => {
  render(
    <MemoryRouter>
      <FinancePrerequisiteScreen
        title="Not ready"
        readiness={{ state: "unavailable", reason: "Waiting", action: null, href: null }}
        returnTo="/finances"
      />
    </MemoryRouter>,
  );
  expect(screen.getByText("Waiting")).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
