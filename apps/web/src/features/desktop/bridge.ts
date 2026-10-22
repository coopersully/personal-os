import { invoke } from "@tauri-apps/api/core";
export const isDesktop = () => "__TAURI_INTERNALS__" in window;
export const hostedServer = "https://nohmi-api.coopersully.me";
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
  petScale?: number;
  petTaskWindow?: "today" | "week" | "month" | "next7" | "next30" | "allUpcoming";
  petReminderWindow?: "today" | "week" | "month" | "next7" | "next30" | "allUpcoming";
  petFinanceWindow?: "today" | "week" | "month" | "last30" | "next30";
  petTasksIncludeOverdue?: boolean;
  petRemindersIncludeOverdue?: boolean;
  petShowRituals?: boolean;
  petShooEnabled?: boolean;
  petShooSensitivity?: "low" | "medium" | "high";
  petSleepEnabled?: boolean;
  petSleepAfterSeconds?: number;
  petWorkspaces: string[];
  widgetWorkspaces: string[];
  activeRemindersEnabled?: boolean;
  notifications: NotificationSettings;
};
export type DesktopStatus = {
  accountId?: string | null;
  settings: DesktopSettings;
  hostedServer: string;
  wallpaperError?: string | null;
  mailError?: string | null;
  native: {
    error?: string;
    accessibilityPermission?: boolean;
    dockGeometryAvailable?: boolean;
    activeRemindersAvailable?: boolean;
    activeRemindersError?: string;
    notificationPermission?: string;
    notificationPermissionPending?: boolean;
    testNotificationStatus?: "idle" | "sending" | "accepted" | "failed";
    notificationAlertsAvailable?: boolean;
    notificationSoundsAvailable?: boolean;
    launchAtLogin?: boolean;
    loginStatus?: string;
    widgetsAvailable?: boolean;
  };
};
export const getDesktopSettings = () => invoke<DesktopStatus>("desktop_settings");
export type DesktopSettingsIdentity = { serverUrl: string; accountId: string | null };
export const desktopSettingsIdentity = (status: DesktopStatus): DesktopSettingsIdentity => ({
  serverUrl: status.settings.serverUrl,
  accountId: status.accountId ?? null,
});
export function requireDesktopSettingsIdentity(
  status: DesktopStatus,
  expected: DesktopSettingsIdentity,
) {
  if (
    status.settings.serverUrl !== expected.serverUrl ||
    (status.accountId ?? null) !== expected.accountId
  )
    throw new Error("Your account changed. Reopen desktop settings.");
}
export const saveDesktopSettings = (
  settings: DesktopSettings,
  expectedIdentity: DesktopSettingsIdentity,
) =>
  invoke<DesktopStatus>("desktop_save_settings", {
    settings,
    expectedIdentity,
    preservePetAppearance: true,
  });
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
        ...(request.headers.has("X-Nohmi-Account")
          ? { expectedAccountId: request.headers.get("X-Nohmi-Account") }
          : {}),
      },
    }),
    request.signal,
  );
  return new Response(status === 204 ? null : body, {
    status,
    headers: { "content-type": "application/json" },
  });
};

export const previewPetScale = (scale: number) => invoke("desktop_preview_pet_scale", { scale });

export type PetAppearanceSession = {
  sessionId: string;
  serverUrl: string;
  accountId: string | null;
};
export type PetAppearanceEdit = PetAppearanceSession & {
  revision: number;
  color: string;
  scale: number;
};
export const beginPetAppearance = () =>
  invoke<PetAppearanceSession>("desktop_begin_pet_appearance");
export const previewPetAppearance = (edit: PetAppearanceEdit) =>
  invoke("desktop_preview_pet_appearance", { edit });
export const savePetAppearance = (edit: PetAppearanceEdit) =>
  invoke<DesktopStatus>("desktop_save_pet_appearance", { edit });
