// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ErrorPage, type ErrorPageKind, errorPageStates } from "./error-page.js";
import ErrorPagePreview from "./error-page-preview.js";

describe("ErrorPage", () => {
  it.each(Object.keys(errorPageStates) as ErrorPageKind[])("renders the %s state", (kind) => {
    render(<ErrorPage kind={kind} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      errorPageStates[kind].title,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(errorPageStates[kind].description);
    expect(screen.queryAllByRole("img")).toHaveLength(0);
    expect(screen.getByRole("link", { name: "Back to Today" })).toHaveAttribute("href", "/today");
    expect(Boolean(screen.queryByRole("button", { name: "Try again" }))).toBe(
      errorPageStates[kind].retry,
    );
  });

  it("retries only when requested and accepts custom actions", async () => {
    const onRetry = vi.fn();
    const view = render(<ErrorPage onRetry={onRetry} />);
    expect(onRetry).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
    view.rerender(<ErrorPage actions={<a href="/settings">Open settings</a>} />);
    expect(screen.getByRole("link", { name: "Open settings" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("previews selectable states and falls back safely for unknown query values", async () => {
    render(
      <MemoryRouter initialEntries={["/dev/errors?state=unknown"]}>
        <ErrorPagePreview />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      errorPageStates["404"].title,
    );
    await userEvent
      .setup()
      .selectOptions(screen.getByRole("combobox", { name: "Error preview" }), "503");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      errorPageStates["503"].title,
    );
  });
});
