import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState, Linking, Text } from "react-native";
import { toast } from "sonner-native";
import { spacing, useTheme } from "../../theme";
import { useAuth } from "../auth/context";
import { Action, Section, ToggleRow } from "../tasks/ui";
import { onDueAlertsRefresh } from "./events";
import { loadAlertItems } from "./load-items";
import { alertTarget, notificationChanges, notificationPrefix, planAlerts } from "./plan";

// No critical/time-sensitive entitlement, badge inflation, or foreground interruption.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: false,
    shouldShowList: true,
  }),
});
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(job: () => Promise<T>): Promise<T> {
  const result = queue.then(job, job);
  queue = result.catch(() => {});
  return result;
}
const Context = createContext<{
  enabled: boolean;
  pending: boolean;
  status: string;
  setEnabled: (value: boolean) => void;
  refresh: () => void;
  test: () => void;
} | null>(null);
const permitted = (p: Notifications.NotificationPermissionsStatus) =>
  p.granted || p.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
async function clearOwned(exceptOwner?: string) {
  for (const request of await Notifications.getAllScheduledNotificationsAsync())
    if (
      request.identifier.startsWith(notificationPrefix) &&
      request.content.data?.owner !== exceptOwner
    )
      await Notifications.cancelScheduledNotificationAsync(request.identifier);
  for (const notification of await Notifications.getPresentedNotificationsAsync())
    if (
      notification.request.identifier.startsWith(notificationPrefix) &&
      notification.request.content.data?.owner !== exceptOwner
    )
      await Notifications.dismissNotificationAsync(notification.request.identifier);
}
const key = (id: string) => `personal-os.due-alerts.v1.${id}`;
const report = () =>
  toast.error("Couldn’t refresh device alerts. Open Task preferences to retry.", {
    id: "due-alert-sync",
  });

export function NotificationProvider({ children }: PropsWithChildren) {
  const { state, session } = useAuth();
  const owner = state.status === "signedIn" ? state.user.id : null;
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const enabledRef = useRef(false);
  const [enabled, setEnabledState] = useState(false);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("Not enabled");
  const handled = useRef(new Set<string>());

  async function sync(id: string) {
    if (ownerRef.current !== id || !enabledRef.current) return;
    const permission = await Notifications.getPermissionsAsync();
    if (ownerRef.current !== id) return;
    setStatus(permitted(permission) ? "Allowed by iOS" : "Not allowed by iOS");
    if (!permitted(permission)) {
      await clearOwned();
      return;
    }
    const api = session.api();
    const items = await loadAlertItems(
      (query) => api.listTaskWorkspace(query),
      () => ownerRef.current === id && enabledRef.current,
    );
    if (!items) return;
    const desired = planAlerts(id, items, Date.now());
    const existing = await Notifications.getAllScheduledNotificationsAsync();
    const changes = notificationChanges(
      desired,
      existing.map((request) => ({
        identifier: request.identifier,
        dueAt: request.content.data?.dueAt,
      })),
    );
    for (const identifier of changes.cancel) {
      if (ownerRef.current !== id || !enabledRef.current) return;
      await Notifications.cancelScheduledNotificationAsync(identifier);
    }
    for (const alert of changes.schedule) {
      if (ownerRef.current !== id || !enabledRef.current) return;
      if (Date.parse(alert.dueAt) <= Date.now()) continue;
      await Notifications.scheduleNotificationAsync({
        identifier: alert.identifier,
        content: {
          title: "nohmi",
          body:
            alert.kind === "task"
              ? "A task is due. Open nohmi to review it."
              : "A reminder is due. Open nohmi to review it.",
          sound: "default",
          data: { ...alert },
          threadIdentifier: "personal-os-tasks",
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(alert.dueAt),
        },
      });
    }
  }
  const syncRef = useRef(sync);
  syncRef.current = sync;
  useEffect(() => {
    if (state.status === "checking" || state.status === "unavailable") return;
    enabledRef.current = false;
    setEnabledState(false);
    setStatus("Not enabled");
    handled.current.clear();
    void serial(async () => {
      await clearOwned(owner ?? undefined);
      if (!owner || ownerRef.current !== owner) return;
      const saved = await SecureStore.getItemAsync(key(owner));
      if (ownerRef.current !== owner) return;
      enabledRef.current = saved === "enabled";
      setEnabledState(enabledRef.current);
      if (enabledRef.current) await syncRef.current(owner);
    }).catch(report);
  }, [owner, state.status]);
  useEffect(() => {
    const refresh = () => {
      const id = ownerRef.current;
      if (id && enabledRef.current) void serial(() => syncRef.current(id)).catch(report);
    };
    const app = AppState.addEventListener("change", (next) => {
      if (next === "active") refresh();
    });
    const stop = onDueAlertsRefresh(refresh);
    const timer = setInterval(() => {
      if (AppState.currentState === "active") refresh();
    }, 60_000);
    return () => {
      app.remove();
      stop();
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (!owner) return;
    const open = (response: Notifications.NotificationResponse) => {
      const target = alertTarget(
        response.notification.request.content.data ?? {},
        ownerRef.current,
      );
      const requestId = response.notification.request.identifier;
      if (!requestId.startsWith(notificationPrefix)) return;
      void Notifications.clearLastNotificationResponseAsync().catch(report);
      const identifier = `${requestId}:${response.notification.date}`;
      if (!target || handled.current.has(identifier)) return;
      handled.current.add(identifier);
      router.push({ pathname: "/task-editor", params: target });
    };
    const listener = Notifications.addNotificationResponseReceivedListener(open);
    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response && ownerRef.current === owner) open(response);
      })
      .catch(report);
    return () => listener.remove();
  }, [owner]);
  async function change(value: boolean) {
    if (!owner || pending) return;
    const id = owner;
    setPending(true);
    const toastId = toast.loading(value ? "Enabling device alerts…" : "Disabling device alerts…");
    try {
      await serial(async () => {
        if (ownerRef.current !== id) throw new Error("Your account changed. Please try again.");
        if (value) {
          let p = await Notifications.getPermissionsAsync();
          if (!permitted(p) && p.canAskAgain)
            p = await Notifications.requestPermissionsAsync({
              ios: { allowAlert: true, allowSound: true, allowBadge: false },
            });
          if (!permitted(p)) {
            setStatus("Not allowed by iOS");
            throw new Error("Notifications are disabled. Allow them in iOS Settings.");
          }
        }
        if (ownerRef.current !== id) throw new Error("Your account changed. Please try again.");
        await SecureStore.setItemAsync(key(id), value ? "enabled" : "disabled");
        enabledRef.current = value;
        setEnabledState(value);
        if (value) await syncRef.current(id);
        else {
          await clearOwned();
          setStatus("Not enabled");
        }
      });
      toast.success(
        value
          ? "Device alert scheduling enabled. iOS controls delivery."
          : "Device alerts disabled.",
        { id: toastId },
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn’t update device alerts.", {
        id: toastId,
      });
    } finally {
      setPending(false);
    }
  }
  return (
    <Context.Provider
      value={{
        enabled,
        pending,
        status,
        setEnabled: (value) => void change(value),
        test: () => {
          if (!owner || !enabledRef.current) return;
          const id = toast.loading("Scheduling test alert…");
          void serial(async () => {
            if (ownerRef.current !== owner || !enabledRef.current)
              throw new Error("Your notification settings changed.");
            if (!permitted(await Notifications.getPermissionsAsync()))
              throw new Error("Allow notifications in iOS Settings first.");
            await Notifications.scheduleNotificationAsync({
              identifier: `${notificationPrefix}${owner}.test`,
              content: {
                title: "nohmi",
                body: "Your test notification.",
                sound: "default",
                data: { owner },
              },
              trigger: {
                type: Notifications.SchedulableTriggerInputTypes.DATE,
                date: new Date(Date.now() + 5000),
              },
            });
          })
            .then(() =>
              toast.success("Test scheduled for 5 seconds. Background nohmi to check the banner.", {
                id,
              }),
            )
            .catch(() => toast.error("Couldn’t schedule a test notification.", { id }));
        },
        refresh: () => {
          if (!owner) return;
          const id = toast.loading("Refreshing device alerts…");
          void serial(() => syncRef.current(owner))
            .then(() => toast.success("Device schedule refreshed. iOS controls delivery.", { id }))
            .catch(() => toast.error("Couldn’t refresh device alerts.", { id }));
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function NotificationSettings() {
  const state = useContext(Context);
  const t = useTheme();
  if (!state) return null;
  return (
    <Section title="Notifications on this iPhone">
      <ToggleRow
        label="Task & reminder due alerts"
        value={state.enabled}
        disabled={state.pending}
        onChange={state.setEnabled}
      />
      <Text style={{ color: t.secondary, padding: spacing.lg, fontSize: 14 }}>
        {state.status}. Schedules the next 50 due alerts. Changes made elsewhere update when you
        reopen nohmi. Focus and Scheduled Summary may delay delivery.
      </Text>
      {state.enabled && (
        <Action label="Send test notification" disabled={state.pending} onPress={state.test} />
      )}
      {state.enabled && (
        <Action label="Refresh device schedule" disabled={state.pending} onPress={state.refresh} />
      )}
      <Action
        label="Open iOS notification settings"
        onPress={() => {
          void Linking.openSettings().catch(() => toast.error("Couldn’t open iOS Settings."));
        }}
      />
    </Section>
  );
}
