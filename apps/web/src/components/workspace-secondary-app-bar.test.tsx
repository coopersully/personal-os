// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import {
  WorkspaceSecondaryAppBar,
  WorkspaceSecondaryAppBarActions,
  WorkspaceSecondaryAppBarContent,
  WorkspaceSecondaryAppBarLeading,
} from "./workspace-secondary-app-bar.js";

describe("WorkspaceSecondaryAppBar", () => {
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
