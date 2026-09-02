// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConnectionList } from "./connection-list.js";

describe("ConnectionList", () => {
  it("shows account identity, capabilities, and a provider-specific add action", async () => {
    const onAdd = vi.fn();
    render(
      <ConnectionList
        addLabel="Add another Google account"
        connections={[{ id: "1", label: "person@example.com", description: "Calendar · Mail" }]}
        emptyText="No Google accounts connected"
        mark="google"
        onAdd={onAdd}
      />,
    );

    expect(screen.getByRole("img", { name: "Google" })).toBeInTheDocument();
    expect(screen.getByText("Calendar · Mail")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add another Google account" }));
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it("keeps the add action available in an empty list", () => {
    render(
      <ConnectionList
        addLabel="Add an Apple account"
        connections={[]}
        emptyText="No Apple accounts connected"
        mark="apple"
        onAdd={vi.fn()}
      />,
    );

    expect(screen.getByText("No Apple accounts connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add an Apple account" })).toBeInTheDocument();
  });
});
