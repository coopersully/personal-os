import type { WeatherCoordinates } from "@personal-os/domain";
import {
  Component,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const LazyMap = lazy(() =>
  import("@/components/ui/map").then((module) => ({ default: module.Map })),
);
class MapBoundary extends Component<
  { children: ReactNode; fallback: ReactNode; onFailure: () => void },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch() {
    this.props.onFailure();
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
  const retryToast = useRef<string | number | undefined>(undefined);
  useEffect(
    () => () => {
      if (retryToast.current !== undefined) toast.dismiss(retryToast.current);
    },
    [],
  );
  const onFailure = useCallback(() => {
    setFailed(true);
    if (retryToast.current !== undefined) {
      toast.error("Could not load the map.", { id: retryToast.current });
      retryToast.current = undefined;
    }
  }, []);
  const onReady = useCallback(() => {
    if (retryToast.current !== undefined) {
      toast.success("Map loaded.", { id: retryToast.current });
      retryToast.current = undefined;
    }
  }, []);
  const apiKey = import.meta.env.VITE_CARTO_API_KEY as string | undefined;
  const fallback = (
    <div
      className={`flex size-full items-center justify-center text-sm text-muted-foreground ${mode === "background" ? "bg-background" : "bg-muted"}`}
    >
      {mode === "preview" ? (
        <div>
          Map unavailable.{" "}
          {apiKey ? (
            <Button
              variant="link"
              onClick={() => {
                retryToast.current = toast.loading("Loading map…");
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
        <MapBoundary key={attempt} fallback={fallback} onFailure={onFailure}>
          <Suspense
            fallback={
              <div
                role="img"
                aria-busy="true"
                className={`size-full ${mode === "background" ? "bg-background" : "bg-muted"}`}
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
              onReady={onReady}
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
