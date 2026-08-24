import { registerSW } from "virtual:pwa-register";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@fontsource/dm-mono/400.css";
import "@fontsource/dm-mono/500.css";
import { App } from "./app.js";
import { MotionProvider } from "./components/motion-provider.js";
import "./styles.css";

document.documentElement.classList.toggle("desktop", "__TAURI_INTERNALS__" in window);
const systemTheme = window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
document.documentElement.classList.toggle("dark", systemTheme === "dark");
document.documentElement.style.colorScheme = systemTheme;

if (import.meta.env.PROD) {
  registerSW({ immediate: true });
} else {
  void clearDevelopmentPwaState();
}

async function clearDevelopmentPwaState() {
  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  }

  if ("caches" in window) {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: true, retry: false, staleTime: 15_000 },
  },
});

const root = document.getElementById("root");
if (!root) throw new Error("The application root is missing.");

createRoot(root).render(
  <StrictMode>
    <MotionProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </MotionProvider>
  </StrictMode>,
);
