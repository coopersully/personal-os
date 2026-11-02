// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { vi } from "vitest";
import { settingsFields } from "../settings/settings-fields";
import { ActiveCardsSettingsPreview, initialCardPreferences } from "./settings-preview";

const mocked = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("sonner", () => ({ toast: mocked.toast }));
function setup(props: ComponentProps<typeof ActiveCardsSettingsPreview> = {}) {
  mocked.toast.mockClear();
  render(<ActiveCardsSettingsPreview {...props} />);
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
    if (["cards-presence", "cards-sharing"].includes(control.id)) continue;
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

it("keeps sample commands inside the frame and restores its situation without changing live settings", async () => {
  const onChange = vi.fn();
  const { frame, ready, send, user } = setup({ value: initialCardPreferences, onChange });
  fireEvent.load(frame);
  expect(send).toHaveBeenLastCalledWith(
    { type: "nohmi:active-cards-preview", command: "hello" },
    window.location.origin,
  );
  ready();
  await user.selectOptions(screen.getByLabelText("Try a situation"), "away");
  expect(send).toHaveBeenLastCalledWith(
    expect.objectContaining({ command: "preferences", presence: "away" }),
    window.location.origin,
  );
  for (const [label, command, extra] of [
    ["Task", "add", { kind: "task" }],
    ["Reminder", "add", { kind: "reminder" }],
    ["Try a connected pair", "join", {}],
    ["Arrival", "sound", { sound: "arrive" }],
    ["Completion", "sound", { sound: "complete" }],
    ["Lock", "sound", { sound: "lock" }],
  ] as const) {
    await user.click(screen.getByRole("button", { name: label }));
    expect(send).toHaveBeenLastCalledWith(
      { type: "nohmi:active-cards-preview", command, ...extra },
      window.location.origin,
    );
  }
  await user.click(screen.getByRole("button", { name: "Reset preview cards" }));
  expect(screen.getByLabelText("Try a situation")).toHaveValue("active");
  expect(send).toHaveBeenCalledWith(
    { type: "nohmi:active-cards-preview", command: "reset" },
    window.location.origin,
  );
  expect(onChange).not.toHaveBeenCalled();
});

it("reports controlled preference intent and distinguishes a slider preview from its commit", async () => {
  const onChange = vi.fn();
  const { ready, user } = setup({
    value: initialCardPreferences,
    onChange,
    live: {
      onMac: true,
      deviceDisabled: false,
      defaultsDisabled: false,
      displays: [{ id: "studio", label: "Studio display", isPrimary: false }],
      focusAvailable: false,
    },
  });
  ready();
  await user.click(screen.getByRole("switch", { name: "New tasks" }));
  expect(onChange).toHaveBeenLastCalledWith("defaultTasks", true, true);
  // The adapter must supply the saved/draft value; the controlled UI does not fabricate it.
  expect(screen.getByRole("switch", { name: "New tasks" })).not.toBeChecked();
  await user.selectOptions(screen.getByLabelText("Start on"), "studio");
  expect(onChange).toHaveBeenLastCalledWith("monitor", "studio", true);
  expect(screen.getByRole("option", { name: "Wait while Focus silences nohmi" })).toBeDisabled();
  expect(screen.queryByLabelText("When screen sharing")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Restore preview defaults" }),
  ).not.toBeInTheDocument();
  const volume = screen.getByRole("slider", { name: "Overall volume" });
  volume.focus();
  await user.keyboard("{ArrowRight}");
  expect(onChange).toHaveBeenCalledWith("volume", 36, false);
  expect(onChange).toHaveBeenCalledWith("volume", 36, true);
});

it("restores local preview preferences and reports the reset through Sonner only", async () => {
  const { ready, send, user } = setup();
  ready();
  await user.click(screen.getByRole("switch", { name: "New tasks" }));
  await user.selectOptions(screen.getByLabelText("Try a situation"), "sharing");
  await user.click(screen.getByRole("button", { name: "Restore preview defaults" }));
  expect(screen.getByRole("switch", { name: "New tasks" })).not.toBeChecked();
  expect(screen.getByLabelText("Try a situation")).toHaveValue("active");
  expect(send).toHaveBeenCalledWith(
    { type: "nohmi:active-cards-preview", command: "reset" },
    window.location.origin,
  );
  expect(send).toHaveBeenLastCalledWith(
    expect.objectContaining({
      command: "preferences",
      prefs: initialCardPreferences,
      presence: "active",
    }),
    window.location.origin,
  );
  expect(mocked.toast).toHaveBeenCalledWith("Preview preferences restored");
  expect(screen.queryByText("Preview preferences restored")).not.toBeInTheDocument();
});

it("rejects same-origin messages from other windows and malformed feedback from its own frame", () => {
  const { frame, ready } = setup();
  const receive = (source: Window | null, data: unknown) =>
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", { origin: window.location.origin, source, data }),
      );
    });
  receive(window, { type: "nohmi:active-cards-ready" });
  expect(screen.getByRole("button", { name: "Gather" })).toBeDisabled();
  receive(window, { type: "nohmi:active-card-feedback", message: "Untrusted completion" });
  expect(mocked.toast).not.toHaveBeenCalled();
  receive(frame.contentWindow, null);
  receive(frame.contentWindow, {
    type: "nohmi:active-card-feedback",
    message: { text: "Malformed" },
  });
  expect(mocked.toast).not.toHaveBeenCalled();
  ready();
  receive(frame.contentWindow, { type: "nohmi:active-card-feedback", message: "a".repeat(220) });
  expect(mocked.toast).toHaveBeenCalledExactlyOnceWith("a".repeat(200));
});
