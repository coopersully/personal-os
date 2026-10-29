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
function Scene() {
  const scene = useRef<HTMLDivElement>(null);
  useSecondaryRitualSky(scene, sky, "occurrence");
  return (
    <div ref={scene}>
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
