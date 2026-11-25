import { registerSW } from "virtual:pwa-register";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { isDesktopShell, prepareWebDocument, WebRoot } from "./web-root.js";

prepareWebDocument();

if (import.meta.env.PROD && !isDesktopShell()) {
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

const root = document.getElementById("root");
if (!root) throw new Error("The application root is missing.");

createRoot(root).render(
  <StrictMode>
    <WebRoot />
  </StrictMode>,
);
