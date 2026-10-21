// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { RitualClouds } from "./ritual-clouds.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("draws deterministic transparent clouds, dims them at night, and releases resize observation", () => {
  vi.stubGlobal("CanvasRenderingContext2D", class {});
  const disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      disconnect = disconnect;
    },
  );
  const putImageData = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 200,
    height: 100,
  } as DOMRect);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    createImageData: (width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
    }),
    putImageData,
  } as unknown as CanvasRenderingContext2D);
  const view = render(<RitualClouds kind="morning" />);
  const morning = putImageData.mock.calls[0]![0].data as Uint8ClampedArray;
  const alpha = (pixels: Uint8ClampedArray) => pixels.filter((_, index) => index % 4 === 3);
  expect(alpha(morning).some((value) => value === 0)).toBe(true);
  expect(Math.max(...alpha(morning))).toBeGreaterThan(0);
  view.rerender(<RitualClouds kind="night" />);
  const night = putImageData.mock.calls[1]![0].data as Uint8ClampedArray;
  expect(Math.max(...alpha(night))).toBeLessThan(Math.max(...alpha(morning)));
  expect(Array.from(alpha(night), Boolean)).toEqual(Array.from(alpha(morning), Boolean));
  expect(view.container.querySelector("canvas")).toHaveAttribute("aria-hidden", "true");
  view.unmount();
  expect(disconnect).toHaveBeenCalledTimes(2);
});
