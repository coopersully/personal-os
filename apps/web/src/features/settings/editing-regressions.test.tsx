// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { SettingsTimeInput } from "@/components/settings-time-input";
import { GoalProgressEditor } from "./goal-progress-editor";
import { RecordSummaryTrial } from "./record-summary-trial";

afterEach(cleanup);

it("clears an optional time through the picker and preserves required times", async () => {
  function OptionalTime() {
    const [value, setValue] = useState("22:00");
    return (
      <>
        <SettingsTimeInput
          aria-label="Quiet hours start"
          type="time"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <output aria-label="Saved time">{value || "None"}</output>
      </>
    );
  }
  const browser = userEvent.setup();
  const view = render(<OptionalTime />);
  await browser.click(screen.getByRole("combobox", { name: "Quiet hours start" }));
  await browser.click(await screen.findByRole("option", { name: "No time" }));
  expect(screen.getByLabelText("Saved time")).toHaveTextContent("None");
  view.rerender(
    <SettingsTimeInput aria-label="Required time" type="time" value="09:00" required />,
  );
  await browser.click(screen.getByRole("combobox", { name: "Required time" }));
  expect(screen.queryByRole("option", { name: "No time" })).not.toBeInTheDocument();
});

it("preserves a rejected progress draft on blur and refocus", async () => {
  const save = vi.fn().mockRejectedValue(new Error("Unavailable"));
  render(<GoalProgressEditor value={20} pending={false} onSave={save} />);
  const browser = userEvent.setup();
  const input = screen.getByLabelText("Progress");
  await browser.clear(input);
  await browser.type(input, "70");
  await browser.tab();
  await waitFor(() => expect(save).toHaveBeenCalledWith(70));
  await act(async () => {});
  expect(input).toHaveValue(70);
  await browser.click(input);
  expect(input).toHaveValue(70);
});

it.each([
  "Goal",
  "Motive",
] as const)("restores the originating %s row after closing its details", async (kind) => {
  render(
    <ul>
      <RecordSummaryTrial
        title="A meaningful outcome"
        kind={kind}
        value={null}
        description="Context"
      />
    </ul>,
  );
  const browser = userEvent.setup();
  const opener = screen.getByRole("button", { name: "A meaningful outcome" });
  await browser.click(opener);
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  await browser.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(opener).toHaveFocus());
  await browser.click(opener);
  await browser.keyboard("{Escape}");
  await waitFor(() => expect(opener).toHaveFocus());
});
