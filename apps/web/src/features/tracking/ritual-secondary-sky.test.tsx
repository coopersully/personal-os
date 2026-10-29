// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { useSecondaryRitualSky } from "./ritual-secondary-sky.js";
import { resolveRitualSky } from "./ritual-sky.js";

const mocks = vi.hoisted(() => ({ desktop: vi.fn(), publish: vi.fn() }));
vi.mock("../desktop/bridge.js", () => ({ isDesktop: mocks.desktop }));
vi.mock("../desktop/ritual-bridge.js", () => ({ publishRitualSkyFrame: mocks.publish }));
const sky = resolveRitualSky({ now: Date.parse("2026-10-29T12:00:00Z"), timeZone: "UTC" });
const motion = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
function Scene({ attached = true }: { attached?: boolean }) {
  const scene = useRef<HTMLDivElement>(null);
  useSecondaryRitualSky(scene, sky, "occurrence");
  return (
    <div ref={attached ? scene : undefined}>
      <canvas className="ritual-clouds" data-sky-frame="0" width={10} height={10} />
    </div>
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  mocks.desktop.mockReturnValue(true);
  mocks.publish.mockResolvedValue(true);
  motion.matches = false;
  vi.stubGlobal("CanvasRenderingContext2D", class {});
  vi.stubGlobal("matchMedia", () => motion);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 200,
    height: 100,
  } as DOMRect);
  let image: ImageData;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    createImageData: (w: number, h: number) =>
      (image = { data: new Uint8ClampedArray(w * h * 4) } as ImageData),
    putImageData: vi.fn(),
    drawImage: vi.fn(),
    getImageData: () => image,
  } as unknown as CanvasRenderingContext2D);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("never starts an artwork IPC feed in a browser", async () => {
  mocks.desktop.mockReturnValue(false);
  render(<Scene />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
  });
  expect(mocks.publish).not.toHaveBeenCalled();
});
it("bounds the raster, keeps one publish in flight and stops on unmount", async () => {
  let resolve!: (value: boolean) => void;
  mocks.publish.mockImplementationOnce(
    () =>
      new Promise<boolean>((done) => {
        resolve = done;
      }),
  );
  const view = render(<Scene />);
  expect(mocks.publish).toHaveBeenCalledOnce();
  const [id, width, height, pixels] = mocks.publish.mock.calls[0]!;
  expect(id).toBe("occurrence");
  expect(width).toBe(50);
  expect(height).toBe(25);
  expect(pixels).toHaveLength(5000);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
  });
  expect(mocks.publish).toHaveBeenCalledOnce();
  await act(async () => {
    resolve(true);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(mocks.publish).toHaveBeenCalledTimes(2);
  view.unmount();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(mocks.publish).toHaveBeenCalledTimes(2);
  expect(motion.removeEventListener).toHaveBeenCalled();
});
it("keeps reduced-motion artwork still but republishes a manually moved cloud frame", async () => {
  motion.matches = true;
  const view = render(<Scene />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
  });
  expect(mocks.publish).toHaveBeenCalledOnce();
  view.container.querySelector<HTMLCanvasElement>("canvas")!.dataset.skyFrame = "manual-drag";
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(mocks.publish).toHaveBeenCalledTimes(2);
});

it("stays usable when the decorative projection has no canvas context", async () => {
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
  const view = render(<Scene />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
  });
  expect(view.container.querySelector(".ritual-clouds")).toBeInTheDocument();
  expect(mocks.publish).not.toHaveBeenCalled();
  expect(motion.addEventListener).not.toHaveBeenCalled();
});

it("waits for a painted cloud frame and visible geometry before sharing artwork", async () => {
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  const view = render(<Scene />);
  const cloud = view.container.querySelector<HTMLCanvasElement>("canvas")!;
  delete cloud.dataset.skyFrame;
  hidden.mockReturnValue(false);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(mocks.publish).not.toHaveBeenCalled();
  cloud.dataset.skyFrame = "painted";
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({
    width: 0,
    height: 0,
  } as DOMRect);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(mocks.publish).not.toHaveBeenCalled();
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({
    width: 3840,
    height: 2160,
  } as DOMRect);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(mocks.publish).toHaveBeenCalledOnce();
  expect(mocks.publish).toHaveBeenCalledWith(
    "occurrence",
    400,
    240,
    expect.any(Uint8ClampedArray),
    sky.dark,
  );
  expect(mocks.publish.mock.calls[0]![3]).toHaveLength(400 * 240 * 4);
});

it("retries a rejected or failed native frame without freezing reduced-motion recovery", async () => {
  motion.matches = true;
  mocks.publish.mockRejectedValueOnce(new Error("bridge temporarily unavailable"));
  mocks.publish.mockResolvedValueOnce(false);
  render(<Scene />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(mocks.publish).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(mocks.publish).toHaveBeenCalledTimes(2);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(mocks.publish).toHaveBeenCalledTimes(3);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
  });
  expect(mocks.publish).toHaveBeenCalledTimes(3);
});

it("refreshes a reduced-motion still on resize and removes that listener on close", async () => {
  motion.matches = true;
  const view = render(<Scene />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(mocks.publish).toHaveBeenCalledTimes(1);
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({
    width: 800,
    height: 400,
  } as DOMRect);
  await act(async () => {
    window.dispatchEvent(new Event("resize"));
  });
  expect(mocks.publish).toHaveBeenCalledTimes(2);
  expect(mocks.publish.mock.calls[1]!.slice(1, 3)).toEqual([200, 100]);
  view.unmount();
  await act(async () => {
    window.dispatchEvent(new Event("resize"));
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(mocks.publish).toHaveBeenCalledTimes(2);
});

it("does not start a projection until the illustrated surface is attached", async () => {
  render(<Scene attached={false} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
  });
  expect(mocks.publish).not.toHaveBeenCalled();
  expect(motion.addEventListener).not.toHaveBeenCalled();
});
