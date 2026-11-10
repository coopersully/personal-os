import Constants from "expo-constants";
import { randomUUID } from "expo-crypto";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { createContext, type PropsWithChildren, useContext, useEffect, useState } from "react";
import { AppState } from "react-native";
import { toast } from "sonner-native";
import { mobileApiOrigin, useAuth } from "../auth/context";
import { Section, ToggleRow } from "../tasks/ui";
import { createFinancePush, financePushPayload } from "./finance-push";

const Context = createContext<{
  enabled: boolean;
  pending: boolean;
  change: (enabled: boolean) => void;
} | null>(null);
const originScope = encodeURIComponent(mobileApiOrigin).replace(/%/g, "_");
const installationKey = `personal-os.finance-push.installation.v1.${originScope}`;
let installation: Promise<string> | undefined;
function installationId() {
  if (installation) return installation;
  installation = (async () => {
    const saved = await SecureStore.getItemAsync(installationKey);
    if (saved) return saved;
    const id = randomUUID();
    await SecureStore.setItemAsync(installationKey, id);
    return id;
  })().catch((error: unknown) => {
    installation = undefined;
    throw error;
  });
  return installation;
}
async function clearPresented() {
  for (const notification of await Notifications.getPresentedNotificationsAsync()) {
    if (financePushPayload(notification.request.content.data))
      await Notifications.dismissNotificationAsync(notification.request.identifier);
  }
}
async function nativeToken() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const token = await Promise.race([
      Notifications.getDevicePushTokenAsync(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error("Couldn’t register this iPhone. Check your connection and try again."),
            ),
          15_000,
        );
      }),
    ]);
    if (token.type !== "ios" || typeof token.data !== "string")
      throw new Error("Native iPhone push registration is unavailable.");
    return token.data;
  } finally {
    clearTimeout(timer);
  }
}
const permitted = (status: Notifications.NotificationPermissionsStatus) =>
  status.granted || status.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
export function FinancePushProvider({ children }: PropsWithChildren) {
  const { state, session } = useAuth();
  const owner = state.status === "signedIn" ? state.user.id : null;
  const epoch = session.epoch();
  const [enabled, setEnabled] = useState(false);
  const [pending, setPending] = useState(false);
  const [controller, setController] = useState<ReturnType<typeof createFinancePush> | null>(null);
  useEffect(() => {
    setEnabled(false);
    setPending(false);
    setController(null);
    // Clear private notifications when entering or leaving an account. Tasks use their own cleanup.
    const cleared = clearPresented();
    if (!owner) {
      void cleared.catch(() => {});
      return;
    }
    const environment: unknown = Constants.expoConfig?.extra?.apnsEnvironment;
    if (environment !== "sandbox" && environment !== "production") {
      void cleared.catch(() => {});
      return;
    }
    let live = true;
    const current = () => live && session.epoch() === epoch;
    const key = `personal-os.finance-push.enabled.v1.${originScope}.${owner}`;
    let consent: boolean | null = null;
    let reportedSyncFailure = false;
    const reportSyncFailure = () => {
      if (!current() || consent === false || reportedSyncFailure) return;
      reportedSyncFailure = true;
      toast.error("Couldn’t sync Finance notifications. Open Notifications settings to retry.", {
        id: "finance-push-sync",
      });
    };
    // API implementation is supplied by the shared typed client, never by an Expo push service.
    const api = session.api();
    const next = createFinancePush({
      api,
      environment,
      current,
      installationId,
      clearPresented,
      readEnabled: async () => {
        await cleared;
        return (await SecureStore.getItemAsync(key)) === "enabled";
      },
      saveEnabled: (value) => SecureStore.setItemAsync(key, value ? "enabled" : "disabled"),
      update: (value) => {
        if (current()) {
          consent = value;
          setEnabled(value);
        }
      },
      permission: async (request) => {
        let permission = await Notifications.getPermissionsAsync();
        if (!current()) return false;
        if (request && !permitted(permission) && permission.canAskAgain)
          permission = await Notifications.requestPermissionsAsync({
            ios: { allowAlert: true, allowSound: true, allowBadge: false },
          });
        return permitted(permission);
      },
      token: nativeToken,
      open: (destination) =>
        router.push({
          pathname: "/(workspaces)/finances/assistant",
          params: {
            view:
              destination === "finance_chat"
                ? "Conversation"
                : destination === "finance_activity"
                  ? "Activity"
                  : "For you",
          },
        }),
    });
    setController(next);
    // Background success stays silent; repeated synchronization failures share one toast.
    const refresh = () => {
      void next
        .refresh()
        .then(() => {
          reportedSyncFailure = false;
        })
        .catch(reportSyncFailure);
    };
    const response = (value: Notifications.NotificationResponse) => {
      if (!financePushPayload(value.notification.request.content.data)) return;
      void next
        .tap(value.notification.request.content.data)
        .then(() => {
          if (current()) void Notifications.clearLastNotificationResponseAsync().catch(() => {});
        })
        .catch(() => {
          if (current()) toast.error("Couldn’t open Finance. Open nohmi to review it.");
        });
    };
    void next
      .restore()
      .then(async () => {
        if (!current()) return;
        const last = await Notifications.getLastNotificationResponseAsync();
        if (last && current()) response(last);
      })
      .catch(reportSyncFailure);
    const app = AppState.addEventListener("change", (value) => {
      if (value === "active") refresh();
    });
    const tokens = Notifications.addPushTokenListener((token) => {
      // Asking APNs for another token inside this listener can trigger a token loop.
      if (token.type === "ios" && typeof token.data === "string")
        void next
          .refresh(token.data)
          .then(() => {
            reportedSyncFailure = false;
          })
          .catch(reportSyncFailure);
    });
    const responses = Notifications.addNotificationResponseReceivedListener(response);
    return () => {
      live = false;
      next.dispose();
      app.remove();
      tokens.remove();
      responses.remove();
      void clearPresented().catch(() => {});
    };
  }, [owner, epoch, session]);
  function change(value: boolean) {
    if (!controller || pending) return;
    setPending(true);
    const id = toast.loading(
      value ? "Enabling Finance notifications…" : "Disabling Finance notifications…",
    );
    void controller
      .change(value)
      .then(() => {
        if (session.epoch() === epoch)
          toast.success(
            value
              ? "Finance notifications enabled. iOS controls delivery."
              : "Finance notifications disabled.",
            { id },
          );
        else toast.dismiss(id);
      })
      .catch((error: unknown) => {
        if (session.epoch() === epoch)
          toast.error(
            error instanceof Error ? error.message : "Couldn’t update Finance notifications.",
            { id },
          );
        else toast.dismiss(id);
      })
      .finally(() => {
        if (session.epoch() === epoch) setPending(false);
      });
  }
  return (
    <Context.Provider value={{ enabled, pending: pending || !controller, change }}>
      {children}
    </Context.Provider>
  );
}
export function FinancePushSettings() {
  const state = useContext(Context);
  if (!state) return null;
  return (
    <Section title="Finance on this iPhone">
      <ToggleRow
        label="Finance notifications"
        value={state.enabled}
        disabled={state.pending}
        onChange={state.change}
      />
    </Section>
  );
}
