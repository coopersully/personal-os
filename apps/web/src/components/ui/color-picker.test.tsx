// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import {
  ColorPicker,
  ColorPickerHue,
  ColorPickerInput,
  ColorPickerSelection,
} from "./color-picker.js";
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
describe("pet color picker", () => {
  it("preserves black and white without emitting edits on mount or controlled changes", () => {
    const change = vi.fn();
    const controls = (
      <>
        <ColorPickerSelection />
        <ColorPickerHue />
        <ColorPickerInput aria-label="Pet color" />
      </>
    );
    const view = render(
      <ColorPicker value="#000000" onChange={change}>
        {controls}
      </ColorPicker>,
    );
    expect(screen.getByLabelText("Pet color")).toHaveValue("#000000");
    view.rerender(
      <ColorPicker value="#FFFFFF" onChange={change}>
        {controls}
      </ColorPicker>,
    );
    expect(screen.getByLabelText("Pet color")).toHaveValue("#FFFFFF");
    expect(change).not.toHaveBeenCalled();
  });
  it("emits a valid color from keyboard interaction", () => {
    const change = vi.fn();
    render(
      <ColorPicker value="#ff0000" onChange={change}>
        <ColorPickerSelection />
      </ColorPicker>,
    );
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowDown" });
    expect(change).toHaveBeenCalledWith("#FC0000");
  });
  it("retains partial hex edits and reports invalid input through Sonner", () => {
    const change = vi.fn();
    render(
      <ColorPicker value="#123456" onChange={change}>
        <ColorPickerInput aria-label="Pet color" />
      </ColorPicker>,
    );
    fireEvent.change(screen.getByLabelText("Pet color"), { target: { value: "#12" } });
    expect(change).not.toHaveBeenCalled();
    fireEvent.blur(screen.getByLabelText("Pet color"));
    expect(toast.error).toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Pet color"), { target: { value: "#abcdef" } });
    expect(change).toHaveBeenCalledWith("#ABCDEF");
  });
});
