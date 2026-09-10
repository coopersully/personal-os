// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { WorkspaceLayout } from "./workspace-layout.js";
import {
  WorkspaceSecondaryAppBar,
  WorkspaceSecondaryAppBarActions,
  WorkspaceSecondaryAppBarContent,
  WorkspaceSecondaryAppBarLeading,
} from "./workspace-secondary-app-bar.js";

describe("WorkspaceSecondaryAppBar", () => {
  it("fills the default layout slot, updates, and removes itself when disabled or unmounted", () => {
    function Example({ enabled = true, show = true, label = "Inbox" }) {
      return (
        <WorkspaceLayout primaryNavigation={<nav aria-label="Primary">Tasks</nav>}>
          <main>
            {show ? (
              <WorkspaceSecondaryAppBar aria-label="Task controls" enabled={enabled}>
                <WorkspaceSecondaryAppBarLeading>{label}</WorkspaceSecondaryAppBarLeading>
              </WorkspaceSecondaryAppBar>
            ) : null}
            Task rows
          </main>
        </WorkspaceLayout>
      );
    }
    const view = render(<Example />);
    const bar = screen.getByRole("navigation", { name: "Task controls" });
    expect(within(screen.getByRole("main")).queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Primary" }).nextElementSibling).toContainElement(
      bar,
    );
    view.rerender(<Example label="Today" />);
    expect(within(bar).getByText("Today")).toBeVisible();
    view.rerender(<Example enabled={false} />);
    expect(screen.queryByRole("navigation", { name: "Task controls" })).not.toBeInTheDocument();
    view.rerender(<Example show={false} />);
    expect(
      screen.getByRole("navigation", { name: "Primary" }).nextElementSibling,
    ).toBeEmptyDOMElement();
  });

  it("keeps spatial Calendar headers inline with their scrollable grid", () => {
    render(
      <WorkspaceLayout primaryNavigation={<nav aria-label="Primary">Calendar</nav>}>
        <main>
          <WorkspaceSecondaryAppBar aria-label="Calendar week navigation" placement="inline">
            Monday
          </WorkspaceSecondaryAppBar>
        </main>
      </WorkspaceLayout>,
    );
    expect(within(screen.getByRole("main")).getByRole("navigation")).toHaveTextContent("Monday");
    expect(
      screen.getByRole("navigation", { name: "Primary" }).nextElementSibling,
    ).toBeEmptyDOMElement();
  });

  it("keeps contextual navigation in one ordered slot contract", () => {
    render(
      <WorkspaceSecondaryAppBar aria-label="Example tools">
        <WorkspaceSecondaryAppBarLeading>Leading</WorkspaceSecondaryAppBarLeading>
        <WorkspaceSecondaryAppBarContent>Content</WorkspaceSecondaryAppBarContent>
        <WorkspaceSecondaryAppBarActions>Actions</WorkspaceSecondaryAppBarActions>
      </WorkspaceSecondaryAppBar>,
    );

    const bar = screen.getByRole("navigation", { name: "Example tools" });
    expect(bar).toHaveAttribute("data-slot", "workspace-secondary-app-bar");
    expect(Array.from(bar.children).map((child) => child.getAttribute("data-slot"))).toEqual([
      "workspace-secondary-app-bar-leading",
      "workspace-secondary-app-bar-content",
      "workspace-secondary-app-bar-actions",
    ]);
    expect(within(bar).getByText("Leading")).toBeVisible();
    expect(within(bar).getByText("Content")).toBeVisible();
    expect(within(bar).getByText("Actions")).toBeVisible();
  });
});
