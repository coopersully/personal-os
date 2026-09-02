import type { WeatherSnapshot } from "@personal-os/domain";
import { CloudIcon, CloudRainIcon, type Icon, MoonIcon, SunIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

export type TodayWeatherKind = "clear-day" | "clear-night" | "cloudy" | "rain";

export function todayWeatherKind(
  weather: WeatherSnapshot | undefined,
  timeZone: string,
): TodayWeatherKind {
  if (!weather) return "cloudy";
  const condition = weather.condition.toLowerCase();
  if (
    weather.alerts.some((alert) => alert.kind === "rain") ||
    /rain|shower|drizzle|storm/.test(condition)
  ) {
    return "rain";
  }
  if (/clear|sunny/.test(condition)) {
    const hour = Number(
      new Intl.DateTimeFormat("en", { hour: "numeric", hourCycle: "h23", timeZone }).format(
        new Date(weather.observedAt),
      ),
    );
    return hour >= 21 || hour < 5 ? "clear-night" : "clear-day";
  }
  return "cloudy";
}

export function todayWeatherIcon(weather: WeatherSnapshot | undefined, timeZone: string): Icon {
  const kind = todayWeatherKind(weather, timeZone);
  if (kind === "rain") return CloudRainIcon;
  if (kind === "clear-day") return SunIcon;
  if (kind === "clear-night") return MoonIcon;
  return CloudIcon;
}

export function TodayWorkspaceIcon({
  className,
  size = "sm",
  timeZone,
  weather,
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
  timeZone: string;
  weather: WeatherSnapshot | undefined;
}) {
  const WeatherIcon = todayWeatherIcon(weather, timeZone);
  return (
    <span
      aria-hidden="true"
      className={cn("workspace-icon", className)}
      data-size={size}
      data-weather={todayWeatherKind(weather, timeZone)}
      data-workspace="today"
    >
      <WeatherIcon />
    </span>
  );
}
