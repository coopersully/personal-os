import type { TodayPreferences, WeatherCoordinates, WeatherSnapshot } from "@personal-os/domain";
import { useEffect, useRef } from "react";
import { useMaterialBackdrop } from "@/components/ui/liquid-glass";
import { LocationMap } from "./location-map";
export function TodayBackground({
  mode,
  weather,
  location,
  timeZone,
}: {
  timeZone: string;
  mode: TodayPreferences["background"];
  weather: WeatherSnapshot | undefined;
  location: WeatherCoordinates | null;
}) {
  if (mode === "map" && location)
    return (
      <div className="today-background">
        <LocationMap mode="background" coordinates={location} />
      </div>
    );
  if (mode === "weather" && weather) {
    const hour = Number(
      new Intl.DateTimeFormat("en", { timeZone, hour: "numeric", hourCycle: "h23" }).format(
        new Date(weather.observedAt),
      ),
    );
    const period =
      hour < 5 || hour >= 21 ? "night" : hour < 10 ? "morning" : hour < 17 ? "day" : "evening";
    return (
      <div
        data-period={period}
        aria-hidden="true"
        className={`today-background today-background--weather ${/rain|storm|snow|cloud|fog/i.test(weather.condition) ? "today-background--overcast" : ""}`}
      >
        <WeatherGlassBackdrop period={period} />
      </div>
    );
  }
  return null;
}

function WeatherGlassBackdrop({ period }: { period: string }) {
  const ref = useRef<HTMLImageElement>(null);
  const setBackdrop = useMaterialBackdrop();
  useEffect(() => {
    const image = ref.current;
    const parent = image?.parentElement;
    if (!image || !parent) return;
    const paint = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.min(1024, parent.clientWidth));
      canvas.height = Math.max(1, Math.min(1024, parent.clientHeight));
      const context = canvas.getContext("2d");
      if (!context) return;
      const theme = getComputedStyle(parent);
      const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
      gradient.addColorStop(0, theme.getPropertyValue(`--weather-sky-${period}-start`).trim());
      gradient.addColorStop(1, theme.getPropertyValue("--background").trim());
      context.fillStyle = gradient;
      context.fillRect(0, 0, canvas.width, canvas.height);
      image.onload = () => setBackdrop(image);
      image.src = canvas.toDataURL();
    };
    paint();
    const resize = new ResizeObserver(paint);
    resize.observe(parent);
    const theme = new MutationObserver(paint);
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    return () => {
      resize.disconnect();
      theme.disconnect();
      image.onload = null;
      setBackdrop(null);
    };
  }, [period, setBackdrop]);
  return <img ref={ref} alt="" aria-hidden="true" className="today-glass-backdrop" />;
}
