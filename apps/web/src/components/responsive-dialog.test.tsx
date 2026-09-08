// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ResponsiveDialog,
  ResponsiveDialogActions,
  ResponsiveDialogBody,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from "./responsive-dialog";

function setViewport(width: number) {
  let currentWidth = width;
  const listeners = new Set<() => void>();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
      dispatchEvent: vi.fn(),
      get matches() {
        return query === "(max-width: 767px)" ? currentWidth < 768 : false;
      },
      media: query,
      onchange: null,
      removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
    })),
  });

  return (nextWidth: number) => {
    currentWidth = nextWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: nextWidth });
    for (const listener of listeners) listener();
  };
}

function Example() {
  return (
    <ResponsiveDialog>
      <ResponsiveDialogTrigger asChild>
        <button type="button">Open details</button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Event details</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Review this event before continuing.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>
          <p>Body content</p>
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <ResponsiveDialogActions>
            <ResponsiveDialogClose asChild>
              <button type="button">Cancel</button>
            </ResponsiveDialogClose>
            <button type="button">Save</button>
          </ResponsiveDialogActions>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

describe("ResponsiveDialog", () => {
  beforeEach(() => setViewport(1024));

  it("opens a standard dialog with the shared slots on desktop", async () => {
    const user = userEvent.setup();
    render(<Example />);

    await user.click(screen.getByRole("button", { name: "Open details" }));

    expect(screen.getByRole("dialog")).toHaveAttribute("data-presentation", "dialog");
    expect(screen.getByRole("heading", { name: "Event details" })).toBeInTheDocument();
    expect(screen.getByText("Review this event before continuing.")).toBeInTheDocument();
    expect(document.querySelector('[data-responsive-slot="body"]')).toHaveTextContent(
      "Body content",
    );
    expect(document.querySelector('[data-responsive-slot="footer"]')).toBeInTheDocument();
    expect(document.querySelector('[data-responsive-slot="actions"]')).toBeInTheDocument();
  });

  it("opens the same content as a bottom drawer on mobile", async () => {
    setViewport(375);
    const user = userEvent.setup();
    render(<Example />);

    await user.click(screen.getByRole("button", { name: "Open details" }));

    await waitFor(() =>
      expect(screen.getByRole("dialog")).toHaveAttribute("data-presentation", "drawer"),
    );
    expect(screen.getByRole("heading", { name: "Event details" })).toBeInTheDocument();
    expect(document.querySelector('[data-responsive-slot="body"]')).toHaveTextContent(
      "Body content",
    );
    expect(document.querySelector('[data-responsive-slot="actions"]')).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps an uncontrolled modal open when the presentation changes", async () => {
    const resize = setViewport(1024);
    const user = userEvent.setup();
    render(<Example />);

    await user.click(screen.getByRole("button", { name: "Open details" }));
    expect(screen.getByRole("dialog")).toHaveAttribute("data-presentation", "dialog");

    act(() => resize(375));

    await waitFor(() =>
      expect(screen.getByRole("dialog")).toHaveAttribute("data-presentation", "drawer"),
    );
    expect(screen.getByRole("heading", { name: "Event details" })).toBeInTheDocument();
  });
});
