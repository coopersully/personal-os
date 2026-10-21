import { useEffect, useRef } from "react";

// Ordered dithering keeps the cloud edges airy without blur or animation.
const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
function noise(x: number, y: number) {
  const hash = (a: number, b: number) => {
    const value = Math.sin(a * 127.1 + b * 311.7 + 42) * 43758.5453;
    return value - Math.floor(value);
  };
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const smooth = (v: number) => v * v * (3 - 2 * v);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const top = hash(ix, iy) * (1 - fx) + hash(ix + 1, iy) * fx;
  const bottom = hash(ix, iy + 1) * (1 - fx) + hash(ix + 1, iy + 1) * fx;
  return top * (1 - fy) + bottom * fy;
}

/** A transparent, bounded-resolution cloud layer shared by native and browser rituals. */
export function RitualClouds({ kind }: { kind: "morning" | "night" }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    if (!element || typeof CanvasRenderingContext2D === "undefined") return;
    const draw = () => {
      const context = element.getContext("2d");
      if (!context) return;
      const bounds = element.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const width = Math.min(800, Math.ceil(bounds.width / 2));
      const height = Math.min(500, Math.ceil(bounds.height / 2));
      element.width = width;
      element.height = height;
      const pixels = context.createImageData(width, height);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const nx = (x / width) * 5;
          const ny = (y / height) * 4;
          const cloud =
            noise(nx, ny * 1.5) * 0.6 + noise(nx * 2, ny * 2) * 0.28 + noise(nx * 4, ny * 4) * 0.12;
          const density = Math.max(0, Math.min(1, (cloud - 0.43) * 2.8));
          const threshold = ((bayer[(y % 4) * 4 + (x % 4)] ?? 0) + 0.5) / 16;
          const index = (y * width + x) * 4;
          pixels.data[index] = 255;
          pixels.data[index + 1] = 255;
          pixels.data[index + 2] = 255;
          pixels.data[index + 3] = density > threshold ? (kind === "night" ? 11 : 27) : 0;
        }
      }
      context.putImageData(pixels, 0, 0);
    };
    draw();
    const resize = new ResizeObserver(draw);
    resize.observe(element);
    return () => resize.disconnect();
  }, [kind]);
  return <canvas ref={canvas} className="ritual-clouds" aria-hidden="true" tabIndex={-1} />;
}
