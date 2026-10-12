import type { WeatherCoordinates } from "@personal-os/domain";
import { Component, lazy, type ReactNode, Suspense, useCallback, useState } from "react";
import { Button } from "@/components/ui/button";

const LazyMap = lazy(() =>
  import("@/components/ui/map").then((module) => ({ default: module.Map })),
);
class MapBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
export function LocationMap({
  coordinates,
  mode,
}: {
  coordinates: WeatherCoordinates;
  mode: "preview" | "background";
}) {
  return (
    <LocationMapInstance
      key={`${coordinates.longitude}:${coordinates.latitude}:${mode}`}
      coordinates={coordinates}
      mode={mode}
    />
  );
}
function LocationMapInstance({
  coordinates,
  mode,
}: {
  coordinates: WeatherCoordinates;
  mode: "preview" | "background";
}) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const onFailure = useCallback(() => setFailed(true), []);
  const apiKey = import.meta.env.VITE_CARTO_API_KEY as string | undefined;
  const fallback = (
    <div className="flex size-full items-center justify-center bg-muted text-sm text-muted-foreground">
      {mode === "preview" ? (
        <div>
          Map unavailable.{" "}
          {apiKey ? (
            <Button
              variant="link"
              onClick={() => {
                setFailed(false);
                setAttempt((value) => value + 1);
              }}
            >
              Retry
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
  return (
    <div className={`today-location-map today-location-map--${mode}`}>
      {!apiKey || failed ? (
        fallback
      ) : (
        <MapBoundary key={attempt} fallback={fallback}>
          <Suspense
            fallback={
              <div
                role="img"
                aria-busy="true"
                className="size-full bg-muted"
                aria-label="Loading map"
              />
            }
          >
            <LazyMap
              longitude={coordinates.longitude}
              latitude={coordinates.latitude}
              interactive={mode === "preview"}
              apiKey={apiKey}
              onFailure={onFailure}
            />
          </Suspense>
        </MapBoundary>
      )}
      <div className="today-map-attribution">
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          © OpenStreetMap contributors
        </a>{" "}
        ·{" "}
        <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">
          © CARTO
        </a>
      </div>
    </div>
  );
}
