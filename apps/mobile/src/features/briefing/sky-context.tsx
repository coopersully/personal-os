import type { WeatherSnapshot } from "@personal-os/domain";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import { toast } from "sonner-native";
import { useAuth } from "../auth/context";
import { readSkyLocation } from "./sky-location";
import { todaySky } from "./sky-presentation";
import { skyPreview } from "./sky-preview";

function deviceTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
const fallback = () => todaySky(Date.now(), deviceTimezone());
const SkyContext = createContext({
  sky: fallback(),
  label: "Time-based sky",
  busy: false,
  refresh: async () => {},
  requestLocation: async () => {},
});
export const useTodaySky = () => useContext(SkyContext);

export function TodaySkyProvider({
  enabled,
  children,
  preview,
}: PropsWithChildren<{ enabled: boolean; preview?: string }>) {
  const sample = skyPreview(preview, typeof __DEV__ !== "undefined" && __DEV__);
  const { state, session } = useAuth();
  const owner = state.user?.id;
  const api = useRef(session.api());
  api.current = session.api();
  const [now, setNow] = useState(Date.now);
  const [result, setResult] = useState<{
    owner: string;
    weather?: WeatherSnapshot;
    granted: boolean;
  }>();
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const current = useRef({ owner, enabled });
  current.current = { owner, enabled };
  const inflight = useRef(false);
  const locationController = useRef<AbortController | null>(null);
  const refresh = useCallback(
    async (request = false) => {
      if (!owner || !enabled || inflight.current || AppState.currentState === "background") return;
      inflight.current = true;
      const version = ++generation.current;
      const controller = new AbortController();
      locationController.current = controller;
      const valid = () =>
        generation.current === version &&
        current.current.owner === owner &&
        current.current.enabled;
      const id = `today-weather-${owner}`;
      if (request) toast.loading("Getting local weather…", { id });
      setBusy(true);
      setNow(Date.now());
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const location = await readSkyLocation(request, controller.signal).catch(() => ({
          granted: false,
          coordinates: undefined,
        }));
        if (!valid()) return;
        // Without device permission/fix, the API resolves the authenticated user's saved location.
        const weather = await Promise.race([
          api.current.getWeather(location.coordinates),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("Weather timeout")), 12_000);
          }),
        ]);
        if (!valid()) return;
        setResult({ owner, weather, granted: location.granted });
        if (request)
          toast.success(
            location.coordinates ? "Local weather updated" : "Using saved-location weather",
            { id },
          );
      } catch {
        if (!valid()) return;
        setResult({ owner, granted: false });
        if (request)
          toast.error("Local weather is unavailable. The sky will follow the time of day.", { id });
      } finally {
        clearTimeout(timer);
        if (valid()) {
          inflight.current = false;
          setBusy(false);
        } else if (request) toast.dismiss(id);
      }
    },
    [owner, enabled],
  );
  useEffect(() => {
    if (!enabled || !owner) return;
    void refresh();
    const weatherTimer = setInterval(() => {
      if (AppState.currentState === "active") void refresh();
    }, 600_000);
    const clock = setInterval(() => {
      if (AppState.currentState === "active") setNow(Date.now());
    }, 60_000);
    const listener = AppState.addEventListener("change", (status) => {
      if (status === "active") {
        setNow(Date.now());
        void refresh();
      } else if (status === "background") {
        locationController.current?.abort();
        generation.current++;
        inflight.current = false;
        setBusy(false);
      }
    });
    return () => {
      locationController.current?.abort();
      generation.current++;
      inflight.current = false;
      setBusy(false);
      clearInterval(weatherTimer);
      clearInterval(clock);
      listener.remove();
      toast.dismiss(`today-weather-${owner}`);
    };
  }, [enabled, owner, refresh]);
  const owned = result?.owner === owner ? result : undefined;
  const sky = todaySky(now, deviceTimezone(), owned?.weather);
  const label =
    sky.source === "weather" && owned?.weather
      ? `${owned.weather.location.shortLabel} · ${Math.round(owned.weather.temperatureF)}° · ${owned.weather.condition}`
      : "Time-based sky";
  return (
    <SkyContext.Provider
      value={{
        sky: sample?.sky ?? sky,
        label: sample?.label ?? label,
        busy,
        refresh: () => refresh(false),
        requestLocation: () => refresh(true),
      }}
    >
      {children}
    </SkyContext.Provider>
  );
}
