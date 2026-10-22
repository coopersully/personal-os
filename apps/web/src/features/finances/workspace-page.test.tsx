// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { api } from "../../api.js";
import { FinanceWorkspacePage } from "./workspace-page";

vi.mock("./use-finance-workspace-readiness", () => ({
  useFinanceWorkspaceReadiness: () => ({
    snapshot: { existingAccess: true, completedAt: null },
    readiness: { workspaceAccessible: true },
    isPending: false,
    isError: false,
  }),
}));

const { activityProps } = vi.hoisted(() => ({ activityProps: vi.fn() }));
vi.mock("../../api.js", () => ({
  api: { listFinanceActivity: vi.fn(), getFinanceActivityEvidence: vi.fn() },
}));
vi.mock("./conversation-page.js", () => ({
  FinanceConversationPage: ({ ownerId }: { ownerId: string }) => <p>Chat for {ownerId}</p>,
}));
vi.mock("./automations-page.js", () => ({
  FinanceAutomationsPage: () => <p>Automations destination</p>,
}));
vi.mock("./activity-page.js", () => ({
  FinanceActivityPage: (props: {
    ownerId: string;
    readActivity: unknown;
    readEvidence: unknown;
  }) => {
    activityProps(props);
    return (
      <p>
        Activity for {props.ownerId}: {typeof props.readActivity}
      </p>
    );
  },
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
  if (section === "activity") {
    expect(activityProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        ownerId: "owner-one",
        readActivity: api.listFinanceActivity,
        readEvidence: api.getFinanceActivityEvidence,
      }),
    );
  }
});
