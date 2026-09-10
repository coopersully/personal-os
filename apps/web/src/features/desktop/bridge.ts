import { invoke } from "@tauri-apps/api/core";
export const isDesktop = () => "__TAURI_INTERNALS__" in window;
export const hostedServer = "https://api.ilo.coopersully.me";
export type NotificationSettings = {
  enabled: boolean;
  tasks: boolean;
  reminders: boolean;
  calendar: boolean;
  mail: boolean;
  advanceMinutes: number;
  sound: boolean;
  preview: boolean;
  quietStart: string | null;
  quietEnd: string | null;
  mailAccountIds: string[];
  calendarIds: string[];
};
export type DesktopSettings = {
  serverUrl: string;
  launchAtLogin: boolean;
  petEnabled: boolean;
  petColor: string;
  petWorkspaces: string[];
  widgetWorkspaces: string[];
  notifications: NotificationSettings;
};
export type DesktopStatus = {
  settings: DesktopSettings;
  hostedServer: string;
  wallpaperError?: string | null;
  mailError?: string | null;
  native: {
    error?: string;
    notificationPermission?: string;
    launchAtLogin?: boolean;
    loginStatus?: string;
    widgetsAvailable?: boolean;
  };
};
export const getDesktopSettings = () => invoke<DesktopStatus>("desktop_settings");
export const saveDesktopSettings = (settings: DesktopSettings) =>
  invoke<DesktopStatus>("desktop_save_settings", { settings });
export const testDesktopServer = (serverUrl: string) =>
  invoke<{ ok: boolean }>("desktop_test_connection", { serverUrl });
export const nativeAction = (action: string) => invoke("desktop_native_action", { action });
let selectedServer: Promise<string> | undefined;
export function resetDesktopConnection() {
  selectedServer = undefined;
}
export const desktopFetch: typeof fetch = async (input, init) => {
  selectedServer ??= getDesktopSettings()
    .then(({ settings }) => settings.serverUrl)
    .catch((error: unknown) => {
      selectedServer = undefined;
      throw error;
    });
  const serverUrl = await selectedServer;
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (init?.signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
  const { status, body } = await invoke<{ status: number; body: string }>("desktop_request", {
    request: {
      serverUrl,
      path: `${url.pathname}${url.search}`,
      method: init?.method ?? "GET",
      body: init?.body ?? null,
    },
  });
  if (init?.signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
  return new Response(status === 204 ? null : body, {
    status,
    headers: { "content-type": "application/json" },
  });
};
