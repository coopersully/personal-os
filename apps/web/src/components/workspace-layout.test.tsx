// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { WorkspaceAppBar } from "./workspace-app-bar.js";
import { WorkspaceLayout } from "./workspace-layout.js";
import { WorkspaceSecondaryAppBar } from "./workspace-secondary-app-bar.js";

describe("workspace frame composition", () => {
  it("portals collection controls into chrome but keeps spatial axes beside their content", () => {
    const { container } = render(
      <WorkspaceLayout
        banner={<p>Offline</p>}
        contentMode="panes"
        primaryNavigation={<WorkspaceAppBar workspace="calendar" identity="Calendar" />}
      >
        <main>
          <WorkspaceSecondaryAppBar aria-label="Collection controls">
            Filter
          </WorkspaceSecondaryAppBar>
          <WorkspaceSecondaryAppBar aria-label="Day axis" placement="inline">
            Monday
          </WorkspaceSecondaryAppBar>
        </main>
      </WorkspaceLayout>,
    );
    expect(
      screen.getByRole("navigation", { name: "Collection controls" }).closest(".workspace-chrome"),
    ).not.toBeNull();
    expect(screen.getByRole("navigation", { name: "Day axis" }).closest("main")).not.toBeNull();
    expect(container.querySelector(".workspace")).toHaveAttribute("data-content-mode", "panes");
  });

  it("preserves a primary action's local state when attention and banner content change", () => {
    function Action() {
      const [value, setValue] = useState("");
      return (
        <input
          aria-label="Draft"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      );
    }
    function Frame({ attention }: { attention: boolean }) {
      return (
        <WorkspaceLayout
          banner={attention ? <p>Offline</p> : null}
          primaryNavigation={
            <WorkspaceAppBar
              workspace="tasks"
              attention={attention ? "Needs review" : null}
              primaryActions={<Action />}
            />
          }
        >
          <main>Tasks</main>
        </WorkspaceLayout>
      );
    }
    const view = render(<Frame attention={false} />);
    fireEvent.change(screen.getByLabelText("Draft"), { target: { value: "Keep my draft" } });
    view.rerender(<Frame attention />);
    expect(screen.getByLabelText("Draft")).toHaveValue("Keep my draft");
    expect(
      screen.getByLabelText("Draft").closest('[data-slot="workspace-primary-actions"]'),
    ).not.toBeNull();
  });
});
