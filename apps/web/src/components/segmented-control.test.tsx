// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it } from "vitest";
import { SegmentedControl, SegmentedControlItem } from "./segmented-control";

function Example() {
  const [value, setValue] = useState("day");
  return (
    <SegmentedControl aria-label="View" value={value} onValueChange={setValue}>
      <SegmentedControlItem value="day">Day</SegmentedControlItem>
      <SegmentedControlItem value="week" disabled>
        Week
      </SegmentedControlItem>
      <SegmentedControlItem value="month">Month</SegmentedControlItem>
    </SegmentedControl>
  );
}

it("keeps a selected view when its active segment is clicked again", async () => {
  const user = userEvent.setup();
  render(<Example />);
  await user.click(screen.getByRole("radio", { name: "Day" }));
  expect(screen.getByRole("radio", { name: "Day" })).toHaveAttribute("aria-checked", "true");
  await user.click(screen.getByRole("radio", { name: "Month" }));
  expect(screen.getByRole("radio", { name: "Month" })).toHaveAttribute("aria-checked", "true");
});

it("preserves primitive keyboard navigation and skips disabled segments", async () => {
  const user = userEvent.setup();
  render(<Example />);
  await user.tab();
  expect(screen.getByRole("radio", { name: "Day" })).toHaveFocus();
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("radio", { name: "Month" })).toHaveFocus();
  await user.keyboard(" ");
  expect(screen.getByRole("radio", { name: "Month" })).toHaveAttribute("aria-checked", "true");
});
