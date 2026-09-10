// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SetupFrame } from "./setup-frame.js";

describe("SetupFrame", () => {
  it("keeps progress and exit together while exposing icon navigation", async () => {
    const back = vi.fn();
    const forward = vi.fn();
    const exit = vi.fn();
    render(
      <SetupFrame back={back} currentStep={2} exit={exit} forward={forward} totalSteps={6}>
        <h1>Choose workspaces</h1>
      </SetupFrame>,
    );

    expect(screen.getByRole("progressbar", { name: "Setup progress" })).toHaveAttribute(
      "aria-valuenow",
      "2",
    );
    expect(screen.queryByText(/Step 2 of 6|33%/)).not.toBeInTheDocument();
    const browser = userEvent.setup();
    await browser.click(screen.getByRole("button", { name: "Back" }));
    await browser.click(screen.getByRole("button", { name: "Continue" }));
    await browser.click(screen.getByRole("button", { name: "Exit Setup" }));
    expect(back).toHaveBeenCalledOnce();
    expect(forward).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledOnce();
  });

  it("omits navigation controls whose callbacks are absent", () => {
    render(
      <SetupFrame currentStep={6} exit={vi.fn()} totalSteps={6}>
        <h1>Ready</h1>
      </SetupFrame>,
    );

    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
  });

  it("keeps a back-only final-step control on the starting edge", () => {
    render(
      <SetupFrame back={vi.fn()} currentStep={6} exit={vi.fn()} totalSteps={6}>
        <h1>Ready</h1>
      </SetupFrame>,
    );

    expect(screen.getByRole("button", { name: "Back" })).toHaveClass(
      "setup-navigation__button--back",
    );
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
  });
});
