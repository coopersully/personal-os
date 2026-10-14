// Adapted from mapcn (MIT), Anmol Saini. See map.LICENSE.
// Registry SHA-256: 1817e5f387d49de7b0ae1ec6c00e8e33583f4276fe7e72eaf1f10cfef43b59eb
import * as MapLibreGL from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { MinusIcon, PlusIcon } from "@/components/icons";
import { useMaterialBackdrop } from "./liquid-glass";
import { Button } from "@/components/ui/button";
import { cartoResource, cartoStyle, mapWorkerPath } from "@/lib/map-provider";

type Theme = "light" | "dark";

// Check the document for an explicit theme (works with next-themes, etc.).
// Covers both `attribute="class"` (the default) and `attribute="data-theme"`.
function getDocumentTheme(): Theme | null {
  if (typeof document === "undefined") return null;
  const root = document.documentElement;
  if (root.classList.contains("dark")) return "dark";
  if (root.classList.contains("light")) return "light";
  const dataTheme = root.dataset.theme;
  if (dataTheme === "dark" || dataTheme === "light") return dataTheme;
  return null;
}

// Get system preference
function getSystemTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function useResolvedTheme(themeProp?: "light" | "dark"): Theme {
  const [detectedTheme, setDetectedTheme] = useState<Theme>(
    () => getDocumentTheme() ?? getSystemTheme(),
  );

  useEffect(() => {
    if (themeProp) return; // Skip detection if theme is provided via prop

    // Watch for document theme changes (e.g., next-themes toggling the class
    // or the data-theme attribute).
    const observer = new MutationObserver(() => {
      const docTheme = getDocumentTheme();
      if (docTheme) {
        setDetectedTheme(docTheme);
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });

    // Also watch for system preference changes
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemChange = (e: MediaQueryListEvent) => {
      // Only use system preference if no document class is set
      if (!getDocumentTheme()) {
        setDetectedTheme(e.matches ? "dark" : "light");
      }
    };
    mediaQuery.addEventListener("change", handleSystemChange);

    return () => {
      observer.disconnect();
      mediaQuery.removeEventListener("change", handleSystemChange);
    };
  }, [themeProp]);

  return themeProp ?? detectedTheme;
}

/** MapCN's map lifecycle and theme detection, reduced to our location use case.
 * Local workers, bounded loading, public CARTO credentials and reicon controls are nohmi adaptations.
 */
export function Map({
  longitude,
  latitude,
  interactive,
  apiKey,
  onFailure,
  onReady,
}: {
  longitude: number;
  latitude: number;
  interactive: boolean;
  apiKey: string;
  onFailure: () => void;
  onReady?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [instance, setInstance] = useState<MapLibreGL.Map | null>(null);
  const [loaded, setLoaded] = useState(false);
  const theme = useResolvedTheme();
  const setBackdrop = useMaterialBackdrop();
  useEffect(() => {
    if (!containerRef.current) return;
    let map: MapLibreGL.Map | undefined;
    let disposed = false;
    let backdropImage: HTMLImageElement | undefined;
    let timer: ReturnType<typeof setTimeout>;
    let resize: ResizeObserver | undefined;
    const fail = () => {
      if (!disposed) onFailure();
    };
    try {
      MapLibreGL.setWorkerUrl(new URL(mapWorkerPath, window.location.href).href);
      map = new MapLibreGL.Map({
        container: containerRef.current,
        style: cartoStyle(theme === "dark"),
        center: [longitude, latitude],
        zoom: interactive ? 12 : 11,
        interactive,
        canvasContextAttributes: { preserveDrawingBuffer: !interactive },
        renderWorldCopies: false,
        attributionControl: false,
        transformRequest: (url) => ({ url: cartoResource(url, apiKey) }),
        fadeDuration: 0,
      });
      setInstance(map);
      setLoaded(false);
      resize = new ResizeObserver(() => map?.resize());
      resize.observe(containerRef.current);
      const marker = document.createElement("div");
      marker.className = "today-map-marker";
      marker.setAttribute("aria-label", "Current location");
      if (interactive)
        new MapLibreGL.Marker({ element: marker }).setLngLat([longitude, latitude]).addTo(map);
      map.once("load", () => {
        clearTimeout(timer);
        if (!disposed) {
          setLoaded(true);
          onReady?.();
        }
      });
      if (!interactive) {
        // A still local image avoids uploading the full map texture every animation frame.
        // It never leaves this document or enters storage. Missing/tainted pixels degrade quietly.
        map.on("idle", () => {
          if (disposed || !map || !containerRef.current) return;
          try {
            backdropImage ??= document.createElement("img");
            backdropImage.alt = "";
            backdropImage.setAttribute("aria-hidden", "true");
            Object.assign(backdropImage.style, { position: "absolute", inset: "0", width: "100%", height: "100%", opacity: "0", pointerEvents: "none" });
            backdropImage.onload = () => { if (!disposed && backdropImage) setBackdrop(backdropImage); };
            containerRef.current.appendChild(backdropImage);
            backdropImage.src = map.getCanvas().toDataURL();
          } catch { setBackdrop(null); }
        });
      }
      map.on("error", fail);
      timer = setTimeout(fail, 10000);
    } catch {
      fail();
    }
    return () => {
      disposed = true;
      resize?.disconnect();
      clearTimeout(timer);
      map?.off("error", fail);
      map?.remove();
      if (backdropImage) { backdropImage.onload = null; backdropImage.remove(); setBackdrop(null); }
    };
  }, [longitude, latitude, interactive, apiKey, theme, onFailure, onReady, setBackdrop]);
  return (
    <div className="relative size-full" aria-label={interactive ? "Location map" : undefined}>
      <div
        ref={containerRef}
        style={{ position: "absolute", inset: 0 }}
        aria-hidden={!interactive}
      />
      {interactive && loaded ? (
        <div className="absolute right-2 top-2 flex flex-col rounded-md border bg-background">
          <Button
            size="icon"
            variant="ghost"
            aria-label="Zoom in"
            onClick={() => instance?.zoomIn({ duration: 0 })}
          >
            <PlusIcon />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Zoom out"
            onClick={() => instance?.zoomOut({ duration: 0 })}
          >
            <MinusIcon />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
