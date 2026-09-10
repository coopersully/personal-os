// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NohmiBrandMark as BrandMark } from "./brand-marks.js";

describe("BrandMark", () => {
  it("renders the neutral wordmark", () => {
    render(<BrandMark />);
    expect(screen.getByText("nohmi")).toHaveClass("brand-wordmark");
    expect(document.querySelector("svg")).not.toBeInTheDocument();
  });

  it("renders the accessible compact mark", () => {
    render(<BrandMark compact />);
    expect(screen.getByRole("img", { name: "nohmi" })).toHaveTextContent("n");
  });

  it("renders the auth mark with a hidden-at-rest orbit", () => {
    render(<BrandMark auth />);
    const mark = screen.getByRole("img", { name: "nohmi" });
    expect(mark).toHaveClass("auth-brand-graphic");
    expect(mark.querySelector(".auth-brand-graphic__orbit")).toBeInTheDocument();
    expect(mark.querySelectorAll(".auth-brand-graphic__orbit-text")).toHaveLength(1);
    expect(mark.querySelector("#auth-brand-graphic-orbit-circle")).toHaveAttribute(
      "d",
      "M 5,50 A 45,45 0 0,1 95,50 A 45,45 0 0,1 5,50",
    );
    const orbitCopy = mark.querySelector("textPath");
    expect(orbitCopy).toHaveAttribute("href", "#auth-brand-graphic-orbit-circle");
    expect(orbitCopy).toHaveAttribute("lengthAdjust", "spacing");
    expect(orbitCopy).toHaveAttribute("textLength", "282.743");
    expect(orbitCopy?.textContent?.match(/know what matters/g)).toHaveLength(2);
    expect(orbitCopy?.textContent?.match(/✦/g)).toHaveLength(2);
    expect(mark.querySelector(".auth-brand-graphic__frame")).toBeInTheDocument();
  });
});
