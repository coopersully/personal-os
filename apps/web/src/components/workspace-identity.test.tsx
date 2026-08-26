// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  WorkspaceIcon,
  workspaceIdentities,
  workspaceIdForPath,
  workspaceIds,
} from "./workspace-identity";

describe("workspace identity", () => {
  it("defines the four first-class workspace identities", () => {
    expect(workspaceIds).toEqual(["calendar", "tasks", "mail", "finances"]);
    expect(Object.values(workspaceIdentities).map(({ label }) => label)).toEqual([
      "Calendar",
      "Tasks",
      "Mail",
      "Finances",
    ]);
  });

  it("renders one decorative, palette-addressable app icon frame", () => {
    render(
      <div data-testid="labelled-workspace">
        <WorkspaceIcon size="lg" workspace="mail" />
        Mail
      </div>,
    );

    const frame = screen.getByTestId("labelled-workspace").querySelector(".workspace-icon");
    expect(frame).toHaveAttribute("aria-hidden", "true");
    expect(frame).toHaveAttribute("data-workspace", "mail");
    expect(frame).toHaveAttribute("data-size", "lg");
    expect(frame?.querySelector("svg")).not.toBeNull();
  });

  it("maps workspace routes without classifying adjacent pages as workspaces", () => {
    expect(workspaceIdForPath("/calendar")).toBe("calendar");
    expect(workspaceIdForPath("/finances/transactions")).toBe("finances");
    expect(workspaceIdForPath("/reminders")).toBeUndefined();
    expect(workspaceIdForPath("/settings")).toBeUndefined();
  });
});
