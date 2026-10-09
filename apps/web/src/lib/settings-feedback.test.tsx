// @vitest-environment jsdom
import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import { toast } from "sonner";
import { expect, it, vi } from "vitest";
import { InlineError } from "../components/async-state.js";
import { MutationFeedback } from "../components/mutation-feedback.js";
import { classifyMutationError } from "./feedback.js";
import { SettingsFeedbackContext, useSettingsError } from "./settings-feedback.js";

vi.mock("sonner", () => ({ toast: { dismiss: vi.fn(), error: vi.fn() } }));
it("deduplicates polling failures, clears recovery, and announces a recurrence", () => {
  const { rerender } = renderHook(
    ({ error }) => useSettingsError(error, "Couldn’t load settings."),
    {
      initialProps: { error: new Error("secret") as Error | null },
      wrapper: ({ children }) => (
        <SettingsFeedbackContext.Provider value={true}>{children}</SettingsFeedbackContext.Provider>
      ),
    },
  );
  expect(toast.error).toHaveBeenCalledTimes(1);
  rerender({ error: new Error("secret") });
  expect(toast.error).toHaveBeenCalledTimes(1);
  rerender({ error: null });
  expect(toast.dismiss).toHaveBeenCalledOnce();
  rerender({ error: new Error("secret") });
  expect(toast.error).toHaveBeenCalledTimes(2);
  expect(toast.error).toHaveBeenLastCalledWith("Couldn’t load settings.", expect.anything());
});

it("keeps settings failures in Sonner with a retry action and no duplicate alert", () => {
  const retry = vi.fn();
  render(
    <SettingsFeedbackContext.Provider value={true}>
      <InlineError error={new Error("offline")} title="Couldn’t load settings." retry={retry} />
      <MutationFeedback
        feedback={classifyMutationError(new Error("offline"), {
          action: "save settings",
          form: true,
        })}
      />
    </SettingsFeedbackContext.Provider>,
  );
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.queryByText("Couldn’t load settings.")).not.toBeInTheDocument();
  const options = vi.mocked(toast.error).mock.calls.at(-1)?.[1];
  expect(options?.action).toEqual({ label: "Try again", onClick: expect.any(Function) });
  const action = options?.action;
  if (!action || typeof action !== "object" || !("onClick" in action))
    throw new Error("Missing retry action");
  render(
    <button type="button" onClick={action.onClick}>
      Retry setting
    </button>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry setting" }));
  expect(retry).toHaveBeenCalledOnce();
});
