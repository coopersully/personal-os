// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { settingsFields } from "../settings/settings-fields";
import { ActiveCardsSettingsPreview } from "./settings-preview";

const mocked = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("sonner", () => ({ toast: mocked.toast }));
function setup() {
  mocked.toast.mockClear();
  render(<ActiveCardsSettingsPreview />);
  const frame = screen.getByTitle(
    "Interactive active task and reminder preview",
  ) as HTMLIFrameElement;
  const frameWindow = frame.contentWindow;
  if (!frameWindow) throw new Error("Preview frame is missing");
  const send = vi.spyOn(frameWindow, "postMessage");
  const ready = () =>
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: window.location.origin,
          source: frame.contentWindow,
          data: { type: "nohmi:active-cards-ready" },
        }),
      );
    });
  return { frame, send, ready, user: userEvent.setup() };
}
it("keeps the sandbox inert until its own same-origin preview is ready", async () => {
  const { ready } = setup();
  expect(screen.getByRole("button", { name: "Gather" })).toBeDisabled();
  act(() =>
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://untrusted.test",
        data: { type: "nohmi:active-cards-ready" },
      }),
    ),
  );
  expect(screen.getByRole("button", { name: "Gather" })).toBeDisabled();
  ready();
  expect(screen.getByRole("button", { name: "Gather" })).toBeEnabled();
});
it("previews separate defaults and sends preference changes only to the card frame", async () => {
  const { ready, send, user } = setup();
  ready();
  expect(screen.getByRole("switch", { name: "New tasks" })).not.toBeChecked();
  expect(screen.getByRole("switch", { name: "New reminders" })).toBeChecked();
  await user.click(screen.getByRole("switch", { name: "New tasks" }));
  await user.selectOptions(screen.getByLabelText("Starting position"), "bottom-right");
  await waitFor(() =>
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({
        command: "preferences",
        prefs: expect.objectContaining({
          defaultTasks: true,
          defaultReminders: true,
          anchor: "bottom-right",
        }),
      }),
      window.location.origin,
    ),
  );
  expect(screen.getByText(/your account and Mac preferences are untouched/)).toBeInTheDocument();
});
it("retains dependent values when their controls are disabled", async () => {
  const { ready, user } = setup();
  ready();
  await user.selectOptions(screen.getByLabelText("Shake sensitivity"), "high");
  await user.click(screen.getByRole("switch", { name: "Shake to gather" }));
  expect(screen.getByLabelText("Shake sensitivity")).toBeDisabled();
  expect(screen.getByLabelText("Shake sensitivity")).toHaveValue("high");
  await user.click(screen.getByRole("switch", { name: "Play card sounds" }));
  const volume = screen.getByRole("slider", { name: "Overall volume" });
  fireEvent.keyDown(volume, { key: "ArrowRight" });
  expect(volume).toHaveAttribute("aria-valuenow", "35");
  expect(volume).not.toHaveAttribute("tabindex", "0");
  expect(screen.getByRole("button", { name: "Arrival" })).toBeDisabled();
});
it("routes preview actions and feedback through the trusted frame and Sonner", async () => {
  const { ready, send, frame, user } = setup();
  ready();
  await user.click(screen.getByRole("button", { name: "Gather" }));
  expect(send).toHaveBeenLastCalledWith(
    { type: "nohmi:active-cards-preview", command: "gather" },
    window.location.origin,
  );
  fireEvent(
    window,
    new MessageEvent("message", {
      origin: window.location.origin,
      source: frame.contentWindow,
      data: { type: "nohmi:active-card-feedback", message: "Sample card completed" },
    }),
  );
  expect(mocked.toast).toHaveBeenCalledWith("Sample card completed");
  expect(screen.queryByText("Sample card completed")).not.toBeInTheDocument();
});

it("indexes every preference control for Settings search", () => {
  setup();
  const fields = settingsFields.filter((field) => field.section === "active-cards");
  for (const control of document.querySelectorAll<HTMLElement>(
    'select, [role="switch"], [data-slot="slider"]',
  )) {
    if (control.id === "cards-presence") continue;
    const label = [...document.querySelectorAll<HTMLLabelElement>("label")].find(
      (label) => label.htmlFor === control.id,
    )?.textContent;
    expect(
      fields.some((field) => field.target === control.id || field.target === label),
      control.id,
    ).toBe(true);
  }
});
it("reapplies preferences when the embedded preview reloads", async () => {
  const { ready, send, user } = setup();
  ready();
  await user.selectOptions(screen.getByLabelText("Starting position"), "bottom-left");
  send.mockClear();
  ready();
  await waitFor(() =>
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "preferences",
        prefs: expect.objectContaining({ anchor: "bottom-left" }),
      }),
      window.location.origin,
    ),
  );
});
