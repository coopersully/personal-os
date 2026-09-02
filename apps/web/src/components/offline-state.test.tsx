// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OfflineState } from "./offline-state.js";

describe("OfflineState", () => {
  it("keeps local environment instructions out of the production outage page", () => {
    render(<OfflineState development={false} onRetry={() => undefined} />);

    expect(screen.getByRole("img", { name: "nohmi" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "We can’t reach nohmi right now." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This is usually temporary. Try again in a moment.",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(/environment/i);
  });

  it("offers the local recovery hint and retries on request during development", async () => {
    const onRetry = vi.fn();
    render(<OfflineState development onRetry={onRetry} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Start the local environment, then try again.",
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
