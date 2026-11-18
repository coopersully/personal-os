// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import { PetSectionScroll } from "./pet-section-scroll.js";

it("navigates section starts, clamps the last section, and respects reduced motion", () => {
  const media = vi.fn(() => ({ matches: false }));
  Object.defineProperty(window, "matchMedia", { configurable: true, value: media });
  const { container } = render(
    <TooltipProvider>
      <PetSectionScroll>
        <header data-pet-scroll-anchor>Today</header>
        <section data-pet-scroll-anchor>Calendar</section>
        <section data-pet-scroll-anchor>Tasks</section>
      </PetSectionScroll>
    </TooltipProvider>,
  );
  const viewport = container.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
  if (!viewport) throw new Error("Missing viewport");
  Object.defineProperties(viewport, { clientHeight: { value: 300 }, scrollHeight: { value: 900 } });
  viewport.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
  container.querySelectorAll<HTMLElement>("[data-pet-scroll-anchor]").forEach((element, index) => {
    element.getBoundingClientRect = () =>
      ({ top: ([12, 212, 812][index] ?? 0) - viewport.scrollTop }) as DOMRect;
  });
  const scrollTo = vi.fn();
  viewport.scrollTo = scrollTo;
  fireEvent.scroll(viewport);
  const previous = screen.getByRole("button", { name: "Previous section" });
  const next = screen.getByRole("button", { name: "Next section" });
  expect(previous).toBeDisabled();
  fireEvent.click(next);
  expect(scrollTo).toHaveBeenLastCalledWith({ top: 200, behavior: "smooth" });
  viewport.scrollTop = 200;
  fireEvent.scroll(viewport);
  fireEvent.click(next);
  expect(scrollTo).toHaveBeenLastCalledWith({ top: 600, behavior: "smooth" });
  viewport.scrollTop = 600;
  fireEvent.scroll(viewport);
  expect(next).toBeDisabled();
  media.mockReturnValue({ matches: true });
  fireEvent.click(previous);
  expect(scrollTo).toHaveBeenLastCalledWith({ top: 200, behavior: "instant" });
  viewport.scrollTop = 325;
  fireEvent.scroll(viewport);
  expect(scrollTo).toHaveBeenCalledTimes(3); // Ordinary scrolling is owned by native proximity snapping.
});
