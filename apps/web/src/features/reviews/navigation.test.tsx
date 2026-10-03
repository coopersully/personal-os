// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ReviewNavigation } from "./navigation.js";

const mocks = vi.hoisted(() => ({ listAgentAccessWorkItems: vi.fn() }));
vi.mock("../../api.js", () => ({ api: mocks }));
function renderEntry() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={["/calendar/decisions"]}>
        <ReviewNavigation workspace="calendar" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
it.each([
  [1, "1 item needs review"],
  [3, "3 items need review"],
  [0, "No items need review"],
  [1200, "1,200 items need review"],
])("shows an honest count of %s", async (count, label) => {
  mocks.listAgentAccessWorkItems.mockResolvedValue({
    summary: { byDomain: { calendar: count } },
    unavailableDomains: [],
  });
  renderEntry();
  const link = await screen.findByRole("button", { name: label as string });
  expect(link.querySelector(".review-navigation__count")).toHaveTextContent(
    count === 1200 ? "1.2k" : String(count),
  );
  if (count) expect(link).toHaveAttribute("data-attention", "true");
  else expect(link).not.toHaveAttribute("data-attention");
});
it("surfaces failed counts instead of claiming there is no work", async () => {
  mocks.listAgentAccessWorkItems.mockRejectedValue(new Error("Unavailable"));
  renderEntry();
  const button = await screen.findByRole("button", { name: "Check review status" });
  expect(button).toHaveAttribute("data-attention", "true");
  expect(button.querySelector(".review-navigation__count")).toHaveTextContent("!");
});
