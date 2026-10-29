import { useEffect, useRef } from "react";

// One timeline drives cloud motion, shape, and ordered dithering.
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

/** Cached fields keep interactive sky animation inexpensive. */
export function RitualClouds({ kind }: { kind: "morning" | "night" }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    if (!element || typeof CanvasRenderingContext2D === "undefined") return;
    const context = element.getContext("2d");
    if (!context) return;
    const texture = document.createElement("canvas");
    const textureContext = texture.getContext("2d");
    if (!textureContext) return;
    const motion =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : undefined;
    let timeline = 0;
    let previousFrame = performance.now();
    let lastPaint = -Infinity;
    let velocity = 1;
    let drag: { id: number; x: number; time: number } | undefined;
    const surface = element.closest<HTMLElement>(
      ".ritual-surface, .ritual-browser-preview, .ritual-sky-preview",
    );
    const thumbnail = surface?.classList.contains("ritual-sky-preview") ?? false;
    let suppressClick = false;
    let dragStartX = 0;
    let pixelsPerScreenPixel = 0.5;
    let width = 0;
    let height = 0;
    let field = new Float32Array(0);
    let variation = new Float32Array(0);
    let image: ImageData | undefined;
    let pattern: CanvasPattern | null = null;
    let ready = false;
    let generation = 0;
    let buildTimer: ReturnType<typeof setTimeout> | undefined;
    const paint = () => {
      if (!image || !ready) return;
      const elapsed = timeline;
      const evolution = Math.sin(elapsed / 56000) * 0.12;
      // Keep the ordered pattern stable, with a tiny, slow change at its edges.
      const thresholds = bayer.map(
        (value, index) => (value + 0.5) / 16 + Math.sin(elapsed / 28000 + index * 0.7) * 0.025,
      );
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const pixel = y * width + x;
          const cloud = (field[pixel] ?? 0) + (variation[pixel] ?? 0) * evolution;
          const density = Math.max(
            0,
            Math.min(0.94, kind === "night" ? (cloud - 0.43) * 2.8 : (cloud - 0.46) * 3.8),
          );
          const index = pixel * 4;
          image.data[index + 3] =
            density > (thresholds[(y % 4) * 4 + (x % 4)] ?? 0) ? (kind === "night" ? 34 : 255) : 0;
        }
      }
      textureContext.putImageData(image, 0, 0);
      pattern = context.createPattern(texture, "repeat");
    };
    const draw = () => {
      if (!width || !height || !pattern) return;
      const offset = (((timeline / 450) % width) + width) % width;
      // One repeating fill has no separately antialiased tile edges. Scroll at
      // display resolution while keeping the expensive density field small.
      const scaleX = element.width / width;
      const scaleY = element.height / height;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, element.width, element.height);
      context.setTransform(scaleX, 0, 0, scaleY, -offset * scaleX, 0);
      context.fillStyle = pattern;
      context.fillRect(offset, 0, width, height);
    };
    const resize = () => {
      const bounds = element.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      // A full Bayer period at the wrap keeps the dither phase continuous.
      const nextWidth = Math.max(4, Math.min(800, Math.ceil(bounds.width / 8) * 4));
      const nextHeight = Math.max(4, Math.min(500, Math.ceil(bounds.height / 8) * 4));
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const displayWidth = Math.ceil(bounds.width * ratio);
      const displayHeight = Math.ceil(bounds.height * ratio);
      if (
        width === nextWidth &&
        height === nextHeight &&
        element.width === displayWidth &&
        element.height === displayHeight
      )
        return;
      width = nextWidth;
      height = nextHeight;
      pixelsPerScreenPixel = width / bounds.width;
      texture.width = width;
      texture.height = height;
      element.width = displayWidth;
      element.height = displayHeight;
      clearTimeout(buildTimer);
      const build = ++generation;
      ready = false;
      pattern = null;
      image = context.createImageData(width, height);
      field = new Float32Array(width * height);
      variation = new Float32Array(width * height);
      let row = 0;
      const buildField = () => {
        if (build !== generation || !image) return;
        const started = performance.now();
        const small = width * height <= 16384;
        for (; row < height; row++) {
          if (!small && performance.now() - started >= 4) {
            buildTimer = setTimeout(buildField, 0);
            return;
          }
          const y = row;
          for (let x = 0; x < width; x++) {
            const index = (y * width + x) * 4;
            image.data[index] = kind === "night" ? 170 : 255;
            image.data[index + 1] = kind === "night" ? 185 : 255;
            image.data[index + 2] = kind === "night" ? 210 : 255;
            const nx = (x / width) * 5;
            const ny = (y / height) * 4;
            const periodic = (scale: number, vertical: number, offset = 0) => {
              const mix = x / width;
              return (
                noise(nx * scale + offset, vertical) * (1 - mix) +
                noise((nx - 5) * scale + offset, vertical) * mix
              );
            };
            field[y * width + x] =
              periodic(1, ny * 1.5) * 0.55 + periodic(2, ny * 3) * 0.3 + periodic(6, ny * 5) * 0.15;
            variation[y * width + x] = periodic(1, ny + 13, 9) - 0.5;
          }
        }
        ready = true;
        paint();
        draw();
      };
      buildField();
    };
    let frame = 0;
    const tick = (instant: number) => {
      const dt = Math.min(instant - previousFrame, 64);
      previousFrame = instant;
      if (!document.hidden && !motion?.matches) {
        if (!drag) {
          timeline += dt * velocity;
          velocity = 1 + (velocity - 1) * Math.exp(-dt / 850);
        }
        if (instant - lastPaint >= 120) {
          paint();
          lastPaint = instant;
        }
        draw();
      }
      if (!motion?.matches) frame = requestAnimationFrame(tick);
    };
    const down = (event: PointerEvent) => {
      if (
        event.button !== 0 ||
        !(event.target instanceof Element) ||
        (!thumbnail &&
          event.target.closest(
            "button,a,input,textarea,select,label,.ritual-card,[data-slot=card],[role=tooltip]",
          )) ||
        surface?.matches(":disabled")
      )
        return;
      suppressClick = false;
      dragStartX = event.clientX;
      drag = { id: event.pointerId, x: event.clientX, time: performance.now() };
      velocity = 0;
      surface?.setPointerCapture(event.pointerId);
      if (surface) surface.style.cursor = "grabbing";
      event.preventDefault();
    };
    const move = (event: PointerEvent) => {
      if (!drag || drag.id !== event.pointerId) return;
      if (Math.abs(event.clientX - dragStartX) > 4) suppressClick = true;
      const instant = performance.now();
      const delta = -(event.clientX - drag.x) * 450 * pixelsPerScreenPixel;
      timeline += delta;
      const speed = delta / Math.max(16, instant - drag.time);
      velocity = Math.max(-120, Math.min(120, velocity * 0.35 + speed * 0.65));
      drag = { id: event.pointerId, x: event.clientX, time: instant };
      // Pointer events only update the timeline; the next frame composites it.
      if (motion?.matches) {
        paint();
        draw();
      }
    };
    const release = () => {
      if (drag && performance.now() - drag.time > 120) velocity = 0;
      if (drag && surface?.hasPointerCapture(drag.id)) surface.releasePointerCapture(drag.id);
      drag = undefined;
      if (surface) surface.style.cursor = "";
    };
    const click = (event: MouseEvent) => {
      if (thumbnail && suppressClick && event.detail !== 0) {
        event.preventDefault();
        event.stopPropagation();
      }
      suppressClick = false;
    };
    const updateMotion = () => {
      cancelAnimationFrame(frame);
      if (motion?.matches) {
        release();
        velocity = 1;
      }
      paint();
      draw();
      previousFrame = performance.now();
      if (!motion?.matches) frame = requestAnimationFrame(tick);
    };
    resize();
    if (!motion?.matches) frame = requestAnimationFrame(tick);
    surface?.addEventListener("click", click, true);
    surface?.addEventListener("pointerdown", down);
    surface?.addEventListener("pointermove", move);
    surface?.addEventListener("pointerup", release);
    surface?.addEventListener("pointercancel", release);
    window.addEventListener("blur", release);
    motion?.addEventListener?.("change", updateMotion);
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => {
      generation++;
      clearTimeout(buildTimer);
      cancelAnimationFrame(frame);
      release();
      surface?.removeEventListener("click", click, true);
      surface?.removeEventListener("pointerdown", down);
      surface?.removeEventListener("pointermove", move);
      surface?.removeEventListener("pointerup", release);
      surface?.removeEventListener("pointercancel", release);
      window.removeEventListener("blur", release);
      observer.disconnect();
      motion?.removeEventListener?.("change", updateMotion);
    };
  }, [kind]);
  return <canvas ref={canvas} className="ritual-clouds" aria-hidden="true" tabIndex={-1} />;
}
