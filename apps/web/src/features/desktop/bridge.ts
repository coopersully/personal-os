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
function cancelledRequest(): DOMException {
  return new DOMException("Request cancelled", "AbortError");
}
async function withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw cancelledRequest();
  let rejectCancellation: (reason: DOMException) => void = () => undefined;
  const abort = () => rejectCancellation(cancelledRequest());
  const cancellation = new Promise<never>((_resolve, reject) => {
    rejectCancellation = reject;
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([operation, cancellation]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
export const desktopFetch: typeof fetch = async (input, init) => {
  selectedServer ??= getDesktopSettings()
    .then(({ settings }) => settings.serverUrl)
    .catch((error: unknown) => {
      selectedServer = undefined;
      throw error;
    });
  const serverUrl = await selectedServer;
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (request.signal.aborted) throw cancelledRequest();
  const requestBody = request.body === null ? null : await request.text();
  const { status, body } = await withAbort(
    invoke<{ status: number; body: string }>("desktop_request", {
      request: {
        serverUrl,
        path: `${url.pathname}${url.search}`,
        method: request.method,
        body: requestBody,
      },
    }),
    request.signal,
  );
  return new Response(status === 204 ? null : body, {
    status,
    headers: { "content-type": "application/json" },
  });
};
