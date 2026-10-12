import type { TodayPreferences, WeatherCoordinates, WeatherSnapshot } from "@personal-os/domain";
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
      />
    );
  }
  return null;
}
