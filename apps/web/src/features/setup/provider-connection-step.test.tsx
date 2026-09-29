// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProviderConnectionStep } from "./provider-connection-step.js";

describe("ProviderConnectionStep", () => {
  it("confirms before continuing without a provider account", async () => {
    const continueSetup = vi.fn();
    let advance: () => void = () => undefined;
    render(
      <ProviderConnectionStep
        accountCount={0}
        confirmation="You haven’t added a Google account. Continue without one?"
        confirmLabel="Continue without Google"
        continueSetup={continueSetup}
        registerContinue={(handler) => {
          advance = handler;
        }}
      >
        <p>No accounts</p>
      </ProviderConnectionStep>,
    );

    act(() => advance());
    expect(
      screen.getByText("You haven’t added a Google account. Continue without one?"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Continue without Google" }));
    expect(continueSetup).toHaveBeenCalledOnce();
  });

  it("cancels without advancing and advances immediately when connected", async () => {
    const continueSetup = vi.fn();
    let advance: () => void = () => undefined;
    const { rerender } = render(
      <ProviderConnectionStep
        accountCount={0}
        confirmation="You haven’t added an Apple account. Continue without one?"
        confirmLabel="Continue without Apple"
        continueSetup={continueSetup}
        registerContinue={(handler) => {
          advance = handler;
        }}
      >
        <p>No accounts</p>
      </ProviderConnectionStep>,
    );

    act(() => advance());
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(continueSetup).not.toHaveBeenCalled();

    rerender(
      <ProviderConnectionStep
        accountCount={1}
        confirmation="You haven’t added an Apple account. Continue without one?"
        confirmLabel="Continue without Apple"
        continueSetup={continueSetup}
        registerContinue={(handler) => {
          advance = handler;
        }}
      >
        <p>Connected</p>
      </ProviderConnectionStep>,
    );
    act(() => advance());
    expect(continueSetup).toHaveBeenCalledOnce();
  });
});
