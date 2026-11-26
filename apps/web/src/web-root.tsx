import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { BrowserRouter } from "react-router-dom";
import "@fontsource-variable/geist";
import { App } from "./app.js";
import { MotionProvider } from "./components/motion-provider.js";
import { PortfolioCursor } from "./components/portfolio-cursor/portfolio-cursor.js";
import { PetOverlay } from "./features/desktop/pet-overlay.js";
import { queryWindowFocusPolicy } from "./features/desktop/query-policy.js";
import { DesktopStartupGate } from "./features/desktop/updates.js";
import { RitualOverlay } from "./features/tracking/ritual-overlay.js";
import { createAppQueryClient } from "./lib/query-client.js";

export function isDesktopShell() {
  return "__TAURI_INTERNALS__" in window;
}

/**
 * Applies the document classes the web UI reads before first paint. Every host (the Vite PWA,
 * the Tauri shell and the Expo web target) calls this once before rendering {@link WebRoot}.
 */
export function prepareWebDocument() {
  const desktop = isDesktopShell();
  const root = document.documentElement;
  root.classList.toggle("desktop", desktop);
  const systemTheme = window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
  root.classList.toggle("dark", systemTheme === "dark");
  root.style.colorScheme = systemTheme;
  if (desktop && window.location.hash === "#ritual") root.classList.add("ritual-window");
  if (desktop && window.location.hash === "#pet") root.classList.add("pet-window");
}

export function createWebQueryClient() {
  return createAppQueryClient({
    queries: {
      refetchOnWindowFocus: queryWindowFocusPolicy(isDesktopShell(), window.location.hash),
      retry: false,
      staleTime: 15_000,
    },
  });
}

/** The complete signed-in and public web UI, independent of the bundler that hosts it. */
export function WebRoot() {
  const [queryClient] = useState(createWebQueryClient);
  const desktop = isDesktopShell();
  return (
    <MotionProvider>
      <PortfolioCursor />
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          {desktop && window.location.hash === "#pet" ? (
            <PetOverlay />
          ) : desktop && window.location.hash === "#ritual" ? (
            <RitualOverlay />
          ) : (
            <DesktopStartupGate>
              <App />
            </DesktopStartupGate>
          )}
        </BrowserRouter>
      </QueryClientProvider>
    </MotionProvider>
  );
}
