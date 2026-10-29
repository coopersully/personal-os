// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { agentAccountFixture } from "../test-fixtures/agent-account";
import { AgentIdentity, agentAvatarCells } from "./agent-identity";

it("renders a local stable avatar through renames without requesting an image", () => {
  const view = render(<AgentIdentity account={agentAccountFixture} />);
  expect(screen.getByText("Cedar Fox")).toBeVisible();
  expect(screen.getByText("Codex · Personal")).toBeVisible();
  const avatar = view.container.querySelector('[data-slot="avatar"]')?.innerHTML;
  view.rerender(
    <AgentIdentity
      account={{
        ...agentAccountFixture,
        displayName: "Maple",
        platform: "claude",
        accountLabel: null,
      }}
    />,
  );
  expect(screen.getByText("Maple")).toBeVisible();
  expect(screen.getByText("Claude")).toBeVisible();
  expect(view.container.querySelector('[data-slot="avatar"]')?.innerHTML).toBe(avatar);
  expect(view.container.querySelector("img,svg")).toBeNull();
});

it("keeps version-one patterns deterministic, distinct, and mirrored", () => {
  const cells = agentAvatarCells("seed-one", 1);
  expect(cells).toEqual(agentAvatarCells("seed-one", 1));
  expect(cells).not.toEqual(agentAvatarCells("seed-two", 1));
  for (let row = 0; row < 5; row++) {
    expect(cells[row * 5]).toBe(cells[row * 5 + 4]);
    expect(cells[row * 5 + 1]).toBe(cells[row * 5 + 3]);
  }
});
