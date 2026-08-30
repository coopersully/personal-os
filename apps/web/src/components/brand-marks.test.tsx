// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BrandMark, brandTitle, hasBrandMark } from "./brand-marks";

describe("brand marks", () => {
  it("names a mark by its owner's brand name, not our provider identifier", () => {
    expect(brandTitle("icloud")).toBe("iCloud");
    expect(brandTitle("claude")).toBe("Claude");
    expect(brandTitle("Claude Code")).toBe("Claude Code");
    expect(hasBrandMark("GOOGLE")).toBe(true);
    expect(hasBrandMark(" x ")).toBe(true);
  });

  it("renders a known mark with an accessible name and a tooltip title", () => {
    render(<BrandMark brand="claude" />);
    const mark = screen.getByRole("img", { name: "Claude" });
    expect(mark.tagName.toLowerCase()).toBe("svg");
    expect(mark.querySelector("title")).toHaveTextContent("Claude");
  });

  it("lets the caller name the mark for its surrounding context", () => {
    render(<BrandMark brand="icloud" label="iCloud calendar" />);
    expect(screen.getByRole("img", { name: "iCloud calendar" })).toBeInTheDocument();
  });

  it("hides a decorative mark from assistive technology", () => {
    render(<BrandMark brand="claude" decorative />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("keeps Google's required multi-color artwork rather than inheriting text color", () => {
    // Google's branding guidelines forbid a monochrome or recolored "G".
    const { container } = render(<BrandMark brand="google" />);
    const fills = [...container.querySelectorAll("path")].map((path) => path.getAttribute("fill"));
    expect(fills).toEqual(["#4285f4", "#34a853", "#fbbc05", "#ea4335"]);
  });

  it("inherits text color for marks their owners permit monochrome", () => {
    const { container } = render(<BrandMark brand="apple" />);
    expect(container.querySelector("path")).toHaveAttribute("fill", "currentColor");
  });

  it("falls back to a monogram for a brand whose artwork we may not ship", () => {
    // No CC0 artwork exists for OpenAI, Microsoft, Slack, or Plaid. Never approximate a trademark.
    for (const brand of ["ChatGPT", "Microsoft", "Plaid"]) {
      expect(hasBrandMark(brand)).toBe(false);
    }
    render(<BrandMark brand="ChatGPT" />);
    const fallback = screen.getByRole("img", { name: "ChatGPT" });
    expect(fallback).toHaveAttribute("data-brand-monogram");
    expect(fallback).toHaveTextContent("C");
  });

  it("hides a decorative monogram and survives an empty brand name", () => {
    const { container } = render(<BrandMark brand="  " decorative />);
    const fallback = container.querySelector("[data-brand-monogram]");
    expect(fallback).toHaveAttribute("aria-hidden", "true");
    expect(fallback).toHaveTextContent("?");
  });
});
