// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";
import { ProductLanding } from "./landing.js";

it("keeps scenery static until an interactive pause control can mount", () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <ProductLanding />
    </MemoryRouter>,
  );
  const document = new DOMParser().parseFromString(html, "text/html");
  expect(document.querySelector(".public-hero")?.getAttribute("data-motion-ready")).toBe("false");
  expect(document.querySelector('button[aria-label="pause scenery"]')?.hasAttribute("hidden")).toBe(
    true,
  );
});

it("lets the visitor pause and resume scenery with a clearly named toggle", () => {
  const { container } = render(
    <MemoryRouter>
      <ProductLanding />
    </MemoryRouter>,
  );
  const hero = container.querySelector(".public-hero");
  const pause = screen.getByRole("button", { name: "pause scenery" });
  expect(pause).toBeVisible();
  expect(pause).toHaveAttribute("aria-pressed", "false");
  expect(hero).toHaveAttribute("data-motion-ready", "true");
  fireEvent.click(pause);
  const resume = screen.getByRole("button", { name: "resume scenery" });
  expect(resume).toHaveAttribute("aria-pressed", "true");
  expect(resume).toHaveAttribute("title", "resume scenery");
  expect(hero).toHaveAttribute("data-scenery-paused", "true");
  fireEvent.click(resume);
  expect(screen.getByRole("button", { name: "pause scenery" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  expect(hero).toHaveAttribute("data-scenery-paused", "false");
});
