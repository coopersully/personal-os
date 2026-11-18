import { type RefObject, useEffect, useRef } from "react";
import { isDesktop } from "../desktop/bridge.js";
import { publishRitualSkyFrame } from "../desktop/ritual-bridge.js";
import { paintRitualAtmosphere } from "./ritual-atmosphere.js";
import type { RitualSkyAppearance } from "./ritual-sky.js";

/** Mirror only our illustrated canvases. Secondary displays never load private ritual UI. */
export function useSecondaryRitualSky(
  scene: RefObject<HTMLDivElement | null>,
  sky: RitualSkyAppearance,
  occurrenceId?: string,
) {
  const latest = useRef(sky);
  useEffect(() => {
    latest.current = sky;
  }, [sky]);
  useEffect(() => {
    if (!occurrenceId || !isDesktop() || typeof CanvasRenderingContext2D === "undefined") return;
    const element = scene.current;
    if (!element) return;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return;
    let active = true,
      inFlight = false,
      elapsed = 0,
      last = performance.now();
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let lastStaticSky: RitualSkyAppearance | undefined;
    let lastStaticFrame: string | undefined;
    async function publish() {
      if (!active || inFlight || document.hidden) return;
      const appearance = latest.current;
      const cloud = element?.querySelector<HTMLCanvasElement>(".ritual-clouds");
      if (!cloud?.width || !cloud.height || cloud.dataset.skyFrame === undefined) return;
      const frame = cloud.dataset.skyFrame;
      if (motion.matches && lastStaticSky === appearance && lastStaticFrame === frame) return;
      const box = element!.getBoundingClientRect();
      if (!box.width || !box.height) return;
      canvas.width = Math.max(1, Math.min(400, Math.ceil(box.width / 4)));
      canvas.height = Math.max(1, Math.min(240, Math.ceil(box.height / 4)));
      const now = performance.now();
      if (!motion.matches) elapsed += Math.min(now - last, 600);
      last = now;
      const image = context!.createImageData(canvas.width, canvas.height);
      paintRitualAtmosphere(canvas.width, canvas.height, appearance, elapsed, image.data, false);
      context!.putImageData(image, 0, 0);
      context!.drawImage(cloud, 0, 0, canvas.width, canvas.height);
      const rgba = context!.getImageData(0, 0, canvas.width, canvas.height).data;
      inFlight = true;
      try {
        const accepted = await publishRitualSkyFrame(
          occurrenceId!,
          canvas.width,
          canvas.height,
          rgba,
          appearance.dark,
        );
        if (active && accepted) {
          lastStaticSky = appearance;
          lastStaticFrame = frame;
        }
      } catch {
        // A decorative projection can retry later; it must never obstruct the checklist.
      } finally {
        inFlight = false;
      }
    }
    void publish();
    const timer = setInterval(() => void publish(), 500);
    const refresh = () => {
      lastStaticSky = undefined;
      void publish();
    };
    window.addEventListener("resize", refresh);
    motion.addEventListener("change", refresh);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("resize", refresh);
      motion.removeEventListener("change", refresh);
    };
  }, [occurrenceId, scene]);
}
