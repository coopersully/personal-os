import { ApiClientError, createApiClient } from "@personal-os/api-client";

import { desktopFetch, hostedServer, isDesktop } from "./features/desktop/bridge.js";

export function apiBaseUrl(configuredBaseUrl: string | undefined, desktop: boolean) {
  if (desktop) return hostedServer;
  return configuredBaseUrl || window.location.origin;
}

// Older desktop builds stored tokens in web storage. Require a fresh Keychain-backed sign-in.
if (isDesktop()) localStorage.removeItem("personal-os.desktop-session");

// The desktop transport resolves the selected server and attaches Keychain credentials.
// Never persist or pass a human session token through the renderer.
export const api = createApiClient({
  baseUrl: apiBaseUrl(import.meta.env.VITE_API_BASE_URL, isDesktop()),
  ...(isDesktop() ? { fetch: desktopFetch } : {}),
});

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 401;
}
