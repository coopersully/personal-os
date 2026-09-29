// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkspaceSkeleton, type WorkspaceSkeletonKind } from "./workspace-skeleton";

const kinds: WorkspaceSkeletonKind[] = [
  "calendar",
  "finances",
  "generic",
  "mail",
  "tasks",
  "today",
];

describe("WorkspaceSkeleton", () => {
  it.each(kinds)("renders a labeled %s preview", (kind) => {
    render(<WorkspaceSkeleton kind={kind} mode="preview" />);
    expect(screen.getByRole("status")).toHaveAttribute("data-workspace-skeleton", kind);
    expect(screen.getByRole("status")).not.toHaveAttribute("aria-busy");
    expect(screen.getByRole("status")).toHaveAccessibleName(/workspace preview/);
  });

  it("marks the default mode as busy", () => {
    render(<WorkspaceSkeleton kind="today" />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveAccessibleName("Loading Today");
  });
});
