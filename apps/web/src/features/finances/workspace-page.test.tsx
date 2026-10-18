// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FinanceWorkspacePage } from "./workspace-page";

vi.mock("../../api.js", () => ({ api: { listFinanceActivity: vi.fn() } }));
vi.mock("./conversation-page.js", () => ({
  FinanceConversationPage: ({ ownerId }: { ownerId: string }) => <p>Chat for {ownerId}</p>,
}));
vi.mock("./automations-page.js", () => ({
  FinanceAutomationsPage: () => <p>Automations destination</p>,
}));
vi.mock("./activity-page.js", () => ({
  FinanceActivityPage: ({ ownerId, readActivity }: { ownerId: string; readActivity: unknown }) => (
    <p>
      Activity for {ownerId}: {typeof readActivity}
    </p>
  ),
}));
vi.mock("./spending-page", () => ({ FinanceSpendingPage: () => <p>Spending destination</p> }));

it.each([
  ["chat", "Chat for owner-one"],
  ["automations", "Automations destination"],
  ["activity", "Activity for owner-one: function"],
  ["spending", "Spending destination"],
])("routes Finance %s to its owned destination", (section, text) => {
  render(
    <MemoryRouter initialEntries={[`/finances/${section}`]}>
      <FinanceWorkspacePage ownerId="owner-one" />
    </MemoryRouter>,
  );
  expect(screen.getByText(text)).toBeInTheDocument();
});
