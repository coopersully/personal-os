// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { formatSidebarCount, SidebarItemMeta } from "./sidebar-item-meta";

describe("sidebar metadata", () => {
  it.each([
    [0, "0"],
    [999, "999"],
    [1200, "1.2k"],
    [1234567, "1.2m"],
  ])("formats %s as %s", (value, display) => {
    expect(formatSidebarCount(value as number)).toBe(display);
  });
  it("keeps attention and count independent with the full accessible count", () => {
    const { rerender } = render(<SidebarItemMeta label="Mail" count={1234} attention />);
    expect(screen.getByLabelText("Mail: Action required · 1,234")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Mail: Action required" })).toBeInTheDocument();
    rerender(<SidebarItemMeta label="Inbox" count={0} />);
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    rerender(<SidebarItemMeta label="Inbox" />);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});
