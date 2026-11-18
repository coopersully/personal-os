// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { ConnectionCard } from "./connection-card";

describe("ConnectionCard", () => {
  const requiredProps = {
    account: { label: "Example", provider: "google", email: "person@example.com" },
    state: "ready" as const,
    status: <span>Connected</span>,
    summary: "Ready to sync",
  };

  it("renders connection identity and health without optional slots", () => {
    const { container } = render(<ConnectionCard {...requiredProps} />);
    expect(screen.getByRole("article")).toHaveAttribute("data-state", "ready");
    expect(container.querySelector(".connection-card__footer")).toBeNull();
  });

  it("renders capabilities and header actions", () => {
    render(
      <ConnectionCard
        {...requiredProps}
        actions={<button type="button">Reconnect</button>}
        capabilities={<span>Mail</span>}
      />,
    );
    expect(screen.getByText("Mail")).toBeVisible();
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeVisible();
  });
});
