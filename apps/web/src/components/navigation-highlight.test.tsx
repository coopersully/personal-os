// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, waitFor } from "@testing-library/react";
import { NavigationHighlight } from "./navigation-highlight";

it("moves one highlight with selection and hides it when no destination is selected", async () => {
  const bounds = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      return {
        x: 0,
        y: this.dataset.position === "second" ? 60 : 0,
        left: 0,
        top: this.dataset.position === "second" ? 60 : 0,
        width: 32,
        height: 48,
        bottom: 48,
        right: 32,
        toJSON() {},
      };
    });
  const content = (active: string) => (
    <div>
      <NavigationHighlight selector='[aria-current="page"]' />
      <a href="#one" aria-current={active === "one" ? "page" : undefined}>
        One
      </a>
      <a href="#two" data-position="second" aria-current={active === "two" ? "page" : undefined}>
        Two
      </a>
    </div>
  );
  const view = render(content("one"));
  const indicator = view.container.querySelector(".navigation-highlight") as HTMLElement;
  expect(indicator.style.transform).toBe("translate(0px, 0px)");
  view.rerender(content("two"));
  await waitFor(() => expect(indicator.style.transform).toBe("translate(0px, 60px)"));
  expect(view.container.querySelectorAll(".navigation-highlight")).toHaveLength(1);
  view.rerender(content("none"));
  await waitFor(() => expect(indicator).toHaveAttribute("hidden"));
  view.unmount();
  bounds.mockRestore();
});
