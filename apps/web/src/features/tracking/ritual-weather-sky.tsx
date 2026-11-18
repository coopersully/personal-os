import type { WeatherCoordinates, WeatherSnapshot } from "@personal-os/domain";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api.js";
import { paintRitualAtmosphere } from "./ritual-atmosphere.js";
import { RitualClouds } from "./ritual-clouds.js";
import { useSecondaryRitualSky } from "./ritual-secondary-sky.js";
import { type RitualSkyAppearance, resolveRitualSky } from "./ritual-sky.js";

/** Reuse a granted device location; a decorative sky must never open a permission prompt. */
async function grantedWeatherCoordinates(): Promise<WeatherCoordinates | undefined> {
  if (!navigator.permissions?.query || !navigator.geolocation) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const permission = await Promise.race([
      navigator.permissions.query({ name: "geolocation" }),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), 500);
      }),
    ]);
    if (permission?.state !== "granted") return undefined;
    return await new Promise((resolve) =>
      navigator.geolocation.getCurrentPosition(
        (position) =>
          resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
        () => resolve(undefined),
        { enableHighAccuracy: false, maximumAge: 10 * 60_000, timeout: 3000 },
      ),
    );
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** Account weather reuses existing location consent or the saved location; it never requests permission. */
function useRitualWeather(enabled: boolean) {
  const [weather, setWeather] = useState<WeatherSnapshot>();
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let inFlight = false;
    async function refresh() {
      if (inFlight || document.hidden) return;
      inFlight = true;
      try {
        const coordinates = await grantedWeatherCoordinates();
        if (!active) return;
        const snapshot = await api.getWeather(coordinates);
        if (active) setWeather(snapshot);
      } catch {
        // A failed read clears the observation; the scene falls back without blocking the ritual.
        if (active) setWeather(undefined);
      } finally {
        inFlight = false;
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 10 * 60_000);
    const visible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [enabled]);
  return weather;
}
function AtmosphereCanvas({ sky }: { sky: RitualSkyAppearance }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef(sky);
  const repaint = useRef<() => void>(() => {});
  useEffect(() => {
    latest.current = sky;
    repaint.current();
  }, [sky]);
  useEffect(() => {
    const element = canvas.current;
    if (!element || typeof CanvasRenderingContext2D === "undefined") return;
    const context = element.getContext("2d");
    if (!context) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let width = 0,
      height = 0,
      elapsed = 0,
      frame = 0,
      last = 0;
    let image: ImageData | undefined;
    const paint = () => {
      if (!image) return;
      paintRitualAtmosphere(width, height, latest.current, elapsed, image.data);
      context.putImageData(image, 0, 0);
    };
    const resize = () => {
      const bounds = element.getBoundingClientRect();
      width = Math.max(4, Math.min(560, Math.ceil(bounds.width / 3)));
      height = Math.max(4, Math.min(360, Math.ceil(bounds.height / 3)));
      element.width = width;
      element.height = height;
      image = context.createImageData(width, height);
      paint();
    };
    const animated = () => ["rain", "snow", "storm", "fog"].includes(latest.current.condition);
    const tick = (instant: number) => {
      if (!document.hidden && instant - last >= 100) {
        elapsed += last ? Math.min(instant - last, 150) : 0;
        last = instant;
        paint();
      }
      if (!motion.matches && animated()) frame = requestAnimationFrame(tick);
    };
    const update = () => {
      cancelAnimationFrame(frame);
      paint();
      if (!motion.matches && animated()) frame = requestAnimationFrame(tick);
    };
    repaint.current = update;
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    update();
    motion.addEventListener("change", update);
    return () => {
      repaint.current = () => {};
      cancelAnimationFrame(frame);
      observer.disconnect();
      motion.removeEventListener("change", update);
    };
  }, []);
  return <canvas ref={canvas} className="ritual-atmosphere" aria-hidden="true" tabIndex={-1} />;
}
export function RitualWeatherSky({
  kind,
  timeZone = "UTC",
  thumbnail = false,
  occurrenceId,
}: {
  kind: "morning" | "night";
  timeZone?: string;
  thumbnail?: boolean;
  occurrenceId?: string;
}) {
  const weather = useRitualWeather(!thumbnail);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (thumbnail) return;
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [thumbnail]);
  // Thumbnails show representative morning/evening lighting and never initiate network work.
  const instant = thumbnail ? Date.UTC(2026, 0, 1, kind === "morning" ? 7 : 20) : now;
  const sky = useMemo(
    () => resolveRitualSky({ now: instant, timeZone: thumbnail ? "UTC" : timeZone, weather }),
    [instant, thumbnail, timeZone, weather],
  );
  const scene = useRef<HTMLDivElement>(null);
  useSecondaryRitualSky(scene, sky, occurrenceId);
  return (
    <div
      ref={scene}
      className="ritual-scene"
      aria-hidden="true"
      data-sky-phase={sky.phase}
      data-sky-condition={sky.condition}
      data-sky-source={sky.source}
      data-sky-dark={sky.dark}
      data-sky-top-dark={sky.topDark}
      data-sky-bottom-dark={sky.bottomDark}
    >
      <AtmosphereCanvas sky={sky} />
      <RitualClouds kind={kind} appearance={sky} />
    </div>
  );
}
