import type { WeatherCoordinates } from "@personal-os/domain";

export type SkyLocation = { granted: boolean; coordinates?: WeatherCoordinates };
/** No background tracking. A bounded, coarse foreground fix; never retain coordinates. */
export async function readSkyLocation(request = false, signal?: AbortSignal): Promise<SkyLocation> {
  if (signal?.aborted) return { granted: false };
  const Location = await import("expo-location");
  const permission = request
    ? await Location.requestForegroundPermissionsAsync()
    : await Location.getForegroundPermissionsAsync();
  if (signal?.aborted) return { granted: false };
  if (!permission.granted) return { granted: false };
  const coordinates = await new Promise<WeatherCoordinates | undefined>((resolve) => {
    let subscription: { remove: () => void } | undefined;
    let finished = false;
    const finish = (value?: WeatherCoordinates) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      subscription?.remove();
      resolve(value);
    };
    const abort = () => finish();
    const timer = setTimeout(() => finish(), 5000);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      finish();
      return;
    }
    void Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Low, distanceInterval: 1000, mayShowUserSettingsDialog: false },
      (position) =>
        finish({
          latitude: Math.round(position.coords.latitude * 100) / 100,
          longitude: Math.round(position.coords.longitude * 100) / 100,
        }),
      () => finish(),
    ).then(
      (watch) => {
        subscription = watch;
        if (finished) watch.remove();
      },
      () => finish(),
    );
  });
  return { granted: true, coordinates };
}
