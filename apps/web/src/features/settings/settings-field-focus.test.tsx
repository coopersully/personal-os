// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
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
  it.each([
    ["goals", "goals:target-date", "Add goal", "goal-target-date"],
    ["motives", "motives:context", "Add motive", "motive-detail"],
  ])("reveals the %s creation form before focusing its searched field", async (section, field, action, target) => {
    function CreationForm() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" aria-label={action} onClick={() => setOpen(true)}>
            +
          </button>
          {open ? <input id={target} aria-label="Requested field" /> : null}
        </>
      );
    }
    mount(field, <CreationForm />, section);
    await waitFor(() => expect(screen.getByLabelText("Requested field")).toHaveFocus());
  });

  it("focuses the matching field without changing its value", async () => {
    mount(
      "profile:time-zone",
      <input id="profile-timezone" aria-label="Time zone" defaultValue="UTC" />,
    );
    await waitFor(() => expect(screen.getByLabelText("Time zone")).toHaveFocus());
    expect(screen.getByLabelText("Time zone")).toHaveValue("UTC");
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
  it("focuses a visible grouped control instead of a hidden duplicate", async () => {
    mount(
      "wallpaper:layout",
      <>
        <div hidden>
          <input id="Layout" aria-label="Hidden layout" />
        </div>
        <fieldset>
          <legend>Layout</legend>
          <select aria-label="Wallpaper layout" defaultValue="mosaic">
            <option value="mosaic">Mosaic</option>
          </select>
        </fieldset>
      </>,
      "wallpaper",
    );
    await waitFor(() => expect(screen.getByLabelText("Wallpaper layout")).toHaveFocus());
    expect(screen.getByLabelText("Wallpaper layout")).toHaveValue("mosaic");
    expect(screen.getByLabelText("Hidden layout")).not.toHaveFocus();
  });
  it("makes a read-only destination focusable without creating a control", async () => {
    mount("wallpaper:layout", <h2>Layout</h2>, "wallpaper");
    const heading = screen.getByRole("heading", { name: "Layout" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(heading).toHaveAttribute("tabindex", "-1");
  });
  it("waits for an unavailable editor and recognizes its count-labelled action", async () => {
    const opened = vi.fn();
    let finishLoading = () => {};
    function Editor() {
      const [loading, setLoading] = useState(true);
      const [open, setOpen] = useState(false);
      finishLoading = () => setLoading(false);
      return (
        <>
          {loading ? <p>Loading goals…</p> : null}
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              opened();
              setOpen(true);
            }}
          >
            Add goal · 2
          </button>
          {open ? <input id="goal-target-date" aria-label="Target date" /> : null}
        </>
      );
    }
    mount("goals:target-date", <Editor />, "goals");
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(opened).not.toHaveBeenCalled();
    act(() => finishLoading());
    await waitFor(() => expect(screen.getByLabelText("Target date")).toHaveFocus());
    expect(opened).toHaveBeenCalledOnce();
  });
  it("ignores arbitrary or cross-section field destinations", () => {
    mount("finances:buffer-target-usd-", <input id="profile-buffer" aria-label="Buffer" />);
    expect(screen.getByLabelText("Buffer")).not.toHaveFocus();
  });
  it("ranks exact field names ahead of synonyms and has unique destinations", () => {
    expect(settingMatchScore("quiet hours", "Quiet hours start", "Notifications")).toBeGreaterThan(
      settingMatchScore("quiet hours", "From", "quiet hours"),
    );
    expect(settingMatchScore("TIME-ZONE", "Time zone")).toBeGreaterThan(0);
    expect(settingMatchScore("salary", "Gross annual income", "salary earnings")).toBeGreaterThan(
      0,
    );
    expect(settingMatchScore("unknown", "Color mode")).toBe(0);
    expect(settingMatchScore("", "Color mode")).toBe(0);
    expect(new Set(settingsFields.map(settingsFieldId)).size).toBe(settingsFields.length);
  });
});
