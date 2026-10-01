// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsFieldFocus } from "./settings-field-focus.js";
import { settingMatchScore, settingsFieldId, settingsFields } from "./settings-fields.js";

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
});
afterEach(() => vi.restoreAllMocks());
function mount(field: string, children: React.ReactNode, section = "profile") {
  return render(
    <MemoryRouter
      initialEntries={[`/settings?section=${section}&field=${encodeURIComponent(field)}`]}
    >
      <SettingsFieldFocus />
      {children}
    </MemoryRouter>,
  );
}
describe("Settings field destinations", () => {
  it("focuses the matching field without changing its value", async () => {
    mount(
      "profile:planning-time-zone",
      <input id="profile-timezone" aria-label="Planning time zone" defaultValue="UTC" />,
    );
    await waitFor(() => expect(screen.getByLabelText("Planning time zone")).toHaveFocus());
    expect(screen.getByLabelText("Planning time zone")).toHaveValue("UTC");
  });
  it("opens a settings editor and waits for the target to mount", async () => {
    function Editor() {
      const [open, setOpen] = useState(false);
      return (
        <>
          {open ? (
            <input id="profile-buffer" aria-label="Buffer target" />
          ) : (
            <button type="button" onClick={() => setOpen(true)}>
              Edit financial profile
            </button>
          )}
        </>
      );
    }
    mount("finances:buffer-target-usd-", <Editor />, "finances");
    await waitFor(() => expect(screen.getByLabelText("Buffer target")).toHaveFocus());
  });
  it("selects the right ritual before focusing an identically labelled field", async () => {
    function Rituals() {
      const [evening, setEvening] = useState(false);
      return (
        <>
          <input
            type="radio"
            aria-label="Evening"
            checked={evening}
            onChange={() => setEvening(true)}
          />
          <label htmlFor="prompt">Prompt</label>
          <input id="prompt" value={evening ? "Evening prompt" : "Morning prompt"} readOnly />
        </>
      );
    }
    mount("rituals:evening-checklist-prompt", <Rituals />, "rituals");
    await waitFor(() => expect(screen.getByLabelText("Prompt")).toHaveFocus());
    expect(screen.getByLabelText("Prompt")).toHaveValue("Evening prompt");
  });
  it("focuses a prerequisite without sending a verification code", async () => {
    const send = vi.fn();
    mount(
      "texting:verification-code",
      <>
        <label htmlFor="phone">Mobile number</label>
        <input id="phone" />
        <button type="button" onClick={send}>
          Send code
        </button>
      </>,
      "texting",
    );
    await waitFor(() => expect(screen.getByLabelText("Mobile number")).toHaveFocus());
    expect(send).not.toHaveBeenCalled();
  });
  it("ignores arbitrary or cross-section field destinations", () => {
    mount("finances:buffer-target-usd-", <input id="profile-buffer" aria-label="Buffer" />);
    expect(screen.getByLabelText("Buffer")).not.toHaveFocus();
  });
  it("ranks exact field names ahead of synonyms and has unique destinations", () => {
    expect(settingMatchScore("quiet hours", "Quiet hours start", "Notifications")).toBeGreaterThan(
      settingMatchScore("quiet hours", "From", "quiet hours"),
    );
    expect(settingMatchScore("TIME-ZONE", "Planning time zone")).toBeGreaterThan(0);
    expect(settingMatchScore("salary", "Gross annual income", "salary earnings")).toBeGreaterThan(
      0,
    );
    expect(settingMatchScore("unknown", "Color mode")).toBe(0);
    expect(settingMatchScore("", "Color mode")).toBe(0);
    expect(new Set(settingsFields.map(settingsFieldId)).size).toBe(settingsFields.length);
  });
});
