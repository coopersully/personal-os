// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
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
    createPattern: vi.fn(() => ({})),
    setTransform: vi.fn(),
    fillRect: vi.fn(),
    clearRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  const view = render(<RitualClouds kind="morning" />);
  const morning = putImageData.mock.calls[0]![0].data as Uint8ClampedArray;
  const alpha = (pixels: Uint8ClampedArray) => pixels.filter((_, index) => index % 4 === 3);
  expect(alpha(morning).some((value) => value === 0)).toBe(true);
  expect(Math.max(...alpha(morning))).toBeGreaterThan(0);
  view.rerender(<RitualClouds kind="night" />);
  const night = putImageData.mock.calls[1]![0].data as Uint8ClampedArray;
  expect(Math.max(...alpha(night))).toBeLessThan(Math.max(...alpha(morning)));
  expect(alpha(night).filter(Boolean).length).toBeGreaterThan(0);
  expect(view.container.querySelector("canvas")).toHaveAttribute("aria-hidden", "true");
  view.unmount();
  expect(disconnect).toHaveBeenCalledTimes(2);
});

it("scrubs the sky when dragging the background without intercepting form controls", () => {
  vi.stubGlobal("CanvasRenderingContext2D", class {});
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const putImageData = vi.fn();
  const setTransform = vi.fn();
  const fillRect = vi.fn();
  let nextFrame: FrameRequestCallback = () => {};
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    nextFrame = callback;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 200,
    height: 100,
  } as DOMRect);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData,
    createPattern: vi.fn(() => ({})),
    setTransform,
    fillRect,
    clearRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  const view = render(
    <div className="ritual-surface">
      <RitualClouds kind="morning" />
      <div data-slot="card">
        <input aria-label="Answer" />
      </div>
    </div>,
  );
  const surface = view.container.firstElementChild as HTMLElement;
  surface.setPointerCapture = vi.fn();
  surface.hasPointerCapture = vi.fn(() => false);
  fireEvent.pointerDown(view.getByLabelText("Answer"), { button: 0, clientX: 100 });
  fireEvent.pointerMove(surface, { clientX: 160 });
  expect(putImageData).toHaveBeenCalledTimes(1);
  fireEvent.pointerDown(surface, { button: 0, clientX: 100 });
  fireEvent.pointerMove(surface, { clientX: 160 });
  for (let x = 161; x < 200; x++) fireEvent.pointerMove(surface, { clientX: x });
  expect(putImageData).toHaveBeenCalledTimes(1);
  nextFrame(performance.now() + 200);
  expect(putImageData).toHaveBeenCalledTimes(2);
  expect(setTransform.mock.calls.at(-1)?.[4]).not.toBe(0);
  expect(fillRect).toHaveBeenCalledTimes(2);
  const canvas = view.container.querySelector("canvas")!;
  expect(canvas.width).toBeGreaterThanOrEqual(200);
  expect(surface.style.cursor).toBe("grabbing");
  fireEvent.pointerUp(surface);
  expect(surface.style.cursor).toBe("");
  const openPreview = vi.fn();
  view.rerender(<button className="ritual-sky-preview" onClick={openPreview}><RitualClouds kind="morning" /></button>);
  const thumbnail = view.container.firstElementChild as HTMLElement;
  thumbnail.setPointerCapture = vi.fn();
  thumbnail.hasPointerCapture = vi.fn(() => false);
  fireEvent.pointerDown(thumbnail, { button: 0, clientX: 20 });
  fireEvent.pointerMove(thumbnail, { clientX: 120 });
  fireEvent.pointerUp(thumbnail);
  fireEvent.click(thumbnail, { detail: 1 });
  expect(openPreview).not.toHaveBeenCalled();
  fireEvent.pointerDown(thumbnail, { button: 0, clientX: 20 });
  fireEvent.pointerUp(thumbnail);
  fireEvent.click(thumbnail, { detail: 1 });
  expect(openPreview).toHaveBeenCalledTimes(1);
});

it("yields during large texture setup and cancels unfinished work on unmount", () => {
  vi.useFakeTimers();
  try {
    vi.stubGlobal("CanvasRenderingContext2D", class {});
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => ++clock);
    vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 1600, height: 1000,
    } as DOMRect);
    const paint = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: paint,
      createPattern: vi.fn(() => ({})),
      setTransform: vi.fn(), fillRect: vi.fn(), clearRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    const view = render(<RitualClouds kind="night" />);
    expect(paint).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    view.unmount();
    vi.runAllTimers();
    expect(paint).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
