import { ApiClientError, createApiClient } from "@personal-os/api-client";

const desktop = "__TAURI_INTERNALS__" in window;
const desktopSessionKey = "personal-os.desktop-session";

export function apiBaseUrl(configuredBaseUrl: string | undefined, isDesktop: boolean) {
  if (configuredBaseUrl) return configuredBaseUrl;
  return isDesktop ? "http://localhost:8788" : window.location.origin;
}

const baseUrl = apiBaseUrl(import.meta.env.VITE_API_BASE_URL, desktop);

export const api = createApiClient(
  desktop
    ? {
        baseUrl,
        onSessionToken: (token) => {
          if (token) localStorage.setItem(desktopSessionKey, token);
          else localStorage.removeItem(desktopSessionKey);
        },
        ...(localStorage.getItem(desktopSessionKey)
          ? { sessionToken: localStorage.getItem(desktopSessionKey) as string }
          : {}),
      }
    : { baseUrl },
);

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 401;
}
