// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceSetupGrid } from "./workspace-setup-grid.js";

const options = [
  { description: "Plan the day", label: "Calendar", value: "calendar" as const },
  { description: "Keep work moving", label: "Tasks", value: "tasks" as const },
];

describe("WorkspaceSetupGrid", () => {
  it("toggles a workspace from the whole card while hiding checkbox chrome", async () => {
    const onValuesChange = vi.fn();
    render(<WorkspaceSetupGrid onValuesChange={onValuesChange} options={options} values={[]} />);

    const checkbox = screen.getByRole("checkbox", { name: "Calendar" });
    expect(checkbox).toHaveClass("sr-only");
    await userEvent.click(screen.getByText("Plan the day"));
    expect(onValuesChange).toHaveBeenCalledWith(["calendar"]);
  });

  it("preserves option order and exposes workspace selection state", async () => {
    const onValuesChange = vi.fn();
    const { container } = render(
      <WorkspaceSetupGrid onValuesChange={onValuesChange} options={options} values={["tasks"]} />,
    );

    expect(screen.getByRole("checkbox", { name: "Tasks" })).toBeChecked();
    expect(container.querySelector('[data-workspace="tasks"]')).toHaveAttribute(
      "data-checked",
      "true",
    );
    await userEvent.click(screen.getByText("Plan the day"));
    expect(onValuesChange).toHaveBeenCalledWith(["calendar", "tasks"]);
  });
});
