// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LogoMark } from "./logo-mark";

describe("LogoMark", () => {
  it("uses the compact modifier only when requested", () => {
    const { container, rerender } = render(<LogoMark />);
    expect(container.firstChild).toHaveClass("logo-mark");
    expect(container.firstChild).not.toHaveClass("logo-mark--compact");

    rerender(<LogoMark compact />);
    expect(container.firstChild).toHaveClass("logo-mark", "logo-mark--compact");
  });
});
