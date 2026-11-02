import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { QueryFeedback } from "../../components/async-state";
import { Button } from "../../components/ui/button";
import { FieldDescription } from "../../components/ui/field";
import { useFeedbackMutation } from "../../lib/use-feedback-mutation";
import {
  type DesktopSettings,
  type DesktopSettingsIdentity,
  desktopSettingsIdentity,
  getDesktopSettings,
  isDesktop,
  nativeAction,
  requireDesktopSettingsIdentity,
  saveDesktopSettings,
} from "../desktop/bridge";
import {
  type PreferenceSession,
  sameSession,
  usePreferenceSession,
} from "../workspace-settings/account-save-session";
import {
  ActiveCardsSettingsPreview,
  type CardPreferences,
  initialCardPreferences,
  type PreferenceKey,
} from "./settings-preview";

type Interactions = NonNullable<DesktopSettings["activeCardInteractions"]>;
type Defaults = { defaultTaskActiveReminder: boolean; defaultReminderActiveReminder: boolean };
const nativeKeys = {
  returnCards: "returnCards",
  shake: "shake",
  sensitivity: "sensitivity",
  snap: "snapping",
  guides: "guides",
  autoLock: "autoLock",
  anchor: "anchor",
  monitor: "startingDisplay",
  spacing: "edgeSpacing",
  remember: "rememberPositions",
  magnet: "magnet",
  sounds: "sounds",
  volume: "volume",
  arrivalVolume: "arrivalVolume",
  completionVolume: "completionVolume",
  interactionVolume: "interactionVolume",
  reduced: "reducedMotion",
  textScale: "textScale",
  titleLines: "titleLines",
  countdown: "countdown",
  focus: "respectFocus",
} as const;
const gainKeys = new Set(["volume", "arrivalVolume", "completionVolume", "interactionVolume"]);
function nativePatch(
  key: PreferenceKey,
  value: CardPreferences[PreferenceKey],
): Partial<Interactions> {
  if (!(key in nativeKeys)) return {};
  const field = nativeKeys[key as keyof typeof nativeKeys];
  return {
    [field]: gainKeys.has(key) ? Number(value) / 100 : key === "focus" ? value === "hide" : value,
  };
}
export function cardPreferencesFromDevice(settings: DesktopSettings): Partial<CardPreferences> {
  const result: Partial<CardPreferences> = { enabled: settings.activeRemindersEnabled ?? true };
  const interactions = settings.activeCardInteractions;
  if (!interactions) return result;
  for (const [key, field] of Object.entries(nativeKeys)) {
    const value = interactions[field as keyof Interactions];
    if (value !== undefined)
      Object.assign(result, {
        [key]: gainKeys.has(key)
          ? Math.round(Number(value) * 100)
          : key === "focus"
            ? value
              ? "hide"
              : "show"
            : value,
      });
  }
  return result;
}
export function ActiveCardsSettings({ ownerId }: { ownerId: string }) {
  const session = usePreferenceSession(useQueryClient());
  return <ActiveCardsSettingsForSession key={`${ownerId}:${session.epoch}`} ownerId={ownerId} />;
}
function ActiveCardsSettingsForSession({ ownerId }: { ownerId: string }) {
  const cache = useQueryClient();
  const session = usePreferenceSession(cache);
  const onMac = isDesktop();
  const [prefs, setPrefs] = useState<CardPreferences>({
    ...initialCardPreferences,
    defaultReminders: false,
  });
  const changed = useRef(new Set<PreferenceKey>());
  const pendingDefaults = useRef<Partial<Defaults>>({});
  const pendingDevice = useRef<Partial<Interactions>>({});
  const pendingEnabled = useRef<boolean | undefined>(undefined);
  const defaultsKey = ["active-reminder-preferences", ownerId];
  const defaults = useQuery({
    queryKey: defaultsKey,
    queryFn: () => api.getActiveReminderPreferences(ownerId),
    enabled: session.owner === ownerId,
  });
  const device = useQuery({
    queryKey: ["desktop-settings"],
    queryFn: getDesktopSettings,
    refetchInterval: 15_000,
    enabled: onMac && session.owner === ownerId,
  });
  const currentSession = (captured: PreferenceSession) => {
    if (captured.owner !== ownerId || !sameSession(cache, captured))
      throw new Error("Your account changed. Reopen active card settings.");
  };
  useEffect(() => {
    if (!defaults.data) return;
    setPrefs((previous) => ({
      ...previous,
      ...(!changed.current.has("defaultTasks")
        ? { defaultTasks: defaults.data.defaultTaskActiveReminder }
        : {}),
      ...(!changed.current.has("defaultReminders")
        ? { defaultReminders: defaults.data.defaultReminderActiveReminder }
        : {}),
    }));
  }, [defaults.data]);
  useEffect(() => {
    if (!device.data || device.data.accountId !== ownerId) return;
    const saved = cardPreferencesFromDevice(device.data.settings);
    setPrefs((previous) => ({
      ...previous,
      ...Object.fromEntries(
        Object.entries(saved).filter(([key]) => !changed.current.has(key as PreferenceKey)),
      ),
    }));
  }, [device.data, ownerId]);
  const saveDefaults = useFeedbackMutation({
    scope: { id: `active-card-defaults:${ownerId}` },
    feedback: { action: "save active card defaults", safeToRetry: true },
    mutationFn: async ({
      patch,
      captured,
    }: {
      patch: Partial<Defaults>;
      captured: PreferenceSession;
    }) => {
      currentSession(captured);
      pendingDefaults.current = { ...pendingDefaults.current, ...patch };
      const current = await api.getActiveReminderPreferences(ownerId);
      currentSession(captured);
      const sent = { ...pendingDefaults.current };
      const value = await api.saveActiveReminderPreferences(
        {
          defaultTaskActiveReminder: current.defaultTaskActiveReminder,
          defaultReminderActiveReminder: current.defaultReminderActiveReminder,
          ...sent,
          expectedRevision: current.revision,
        },
        ownerId,
      );
      return { value, sent, captured };
    },
    onSuccess: ({ value, sent, captured }) => {
      if (!sameSession(cache, captured)) return;
      for (const key of Object.keys(sent) as Array<keyof Defaults>)
        if (pendingDefaults.current[key] === sent[key]) delete pendingDefaults.current[key];
      cache.setQueryData(defaultsKey, value);
    },
  });
  const saveDevice = useFeedbackMutation({
    scope: { id: "desktop-preferences" },
    feedback: { action: "save active card settings", safeToRetry: true },
    mutationFn: async ({
      patch,
      enabled,
      identity,
      captured,
    }: {
      patch: Partial<Interactions>;
      enabled?: boolean;
      identity: DesktopSettingsIdentity | null;
      captured: PreferenceSession;
    }) => {
      currentSession(captured);
      if (!identity || identity.accountId !== ownerId)
        throw new Error("Reopen active card settings on your Mac.");
      pendingDevice.current = { ...pendingDevice.current, ...patch };
      if (enabled !== undefined) pendingEnabled.current = enabled;
      const current = await getDesktopSettings();
      currentSession(captured);
      requireDesktopSettingsIdentity(current, identity);
      const sent = { ...pendingDevice.current };
      const sentEnabled = pendingEnabled.current;
      const value = await saveDesktopSettings(
        {
          ...current.settings,
          ...(sentEnabled === undefined ? {} : { activeRemindersEnabled: sentEnabled }),
          activeCardInteractions: {
            ...current.settings.activeCardInteractions,
            ...sent,
          } as Interactions,
        },
        identity,
      );
      return { value, sent, sentEnabled, captured };
    },
    onSuccess: ({ value, sent, sentEnabled, captured }) => {
      if (!sameSession(cache, captured)) return;
      for (const key of Object.keys(sent) as Array<keyof Interactions>)
        if (pendingDevice.current[key] === sent[key]) delete pendingDevice.current[key];
      if (pendingEnabled.current === sentEnabled) pendingEnabled.current = undefined;
      cache.setQueryData(["desktop-settings"], value);
    },
  });
  const focusPermission = useFeedbackMutation({
    feedback: {
      action: "request Focus status access",
      pending: "Requesting Focus status access…",
      success: "Focus status access allowed",
      safeToRetry: true,
    },
    mutationFn: async () => {
      const captured = session;
      const identity = device.data ? desktopSettingsIdentity(device.data) : null;
      currentSession(captured);
      if (!identity) throw new Error("Desktop settings are still loading.");
      await nativeAction("request_focus_permission");
      for (let attempt = 0; attempt < 120; attempt++) {
        const current = await getDesktopSettings();
        currentSession(captured);
        requireDesktopSettingsIdentity(current, identity);
        cache.setQueryData(["desktop-settings"], current);
        if (!current.native.focusPermissionPending) {
          if (current.native.focusPermission === "authorized") return;
          throw new Error(
            "Focus status access was not allowed. Check nohmi’s Focus permissions in macOS settings.",
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new Error(
        "Focus access is still awaiting a response. Finish the macOS prompt, then try again.",
      );
    },
    onSuccess: () => cache.invalidateQueries({ queryKey: ["desktop-settings"] }),
  });
  const nativeAvailable =
    device.data?.native.activeRemindersAvailable === true && device.data.accountId === ownerId;
  const change = (key: PreferenceKey, value: CardPreferences[PreferenceKey], commit = true) => {
    changed.current.add(key);
    setPrefs((previous) => ({ ...previous, [key]: value }));
    if (!commit) return;
    if (key === "defaultTasks" || key === "defaultReminders") {
      saveDefaults.mutate({
        patch: {
          [key === "defaultTasks" ? "defaultTaskActiveReminder" : "defaultReminderActiveReminder"]:
            Boolean(value),
        },
        captured: session,
      });
    } else if (onMac && nativeAvailable && key !== "dock") {
      saveDevice.mutate({
        patch: nativePatch(key, value),
        ...(key === "enabled" ? { enabled: Boolean(value) } : {}),
        identity: device.data ? desktopSettingsIdentity(device.data) : null,
        captured: session,
      });
    }
  };
  return (
    <>
      <QueryFeedback query={defaults} title="Couldn’t load active card defaults." />
      {onMac ? (
        <QueryFeedback query={device} title="Couldn’t load this Mac’s active card settings." />
      ) : null}
      <ActiveCardsSettingsPreview
        value={prefs}
        onChange={change}
        live={{
          onMac: onMac && nativeAvailable,
          defaultsDisabled: !defaults.isSuccess || session.owner !== ownerId,
          deviceDisabled: onMac && !nativeAvailable,
          displays: device.data?.native.displays ?? [],
          focusDetails: (
            <>
              <FieldDescription>
                macOS does not report all screen-sharing sessions. Pause active cards here before
                sharing private material.
              </FieldDescription>
              {onMac && nativeAvailable ? (
                <>
                  <FieldDescription>
                    Focus status: {device.data?.native.focusStatus ?? "unknown"}. When waiting for
                    Focus, unknown status keeps cards hidden and ordinary notifications remain
                    available.
                  </FieldDescription>
                  <Button
                    variant="outline"
                    disabled={
                      focusPermission.isPending || device.data?.native.focusPermissionPending
                    }
                    onClick={() => focusPermission.mutate()}
                  >
                    Allow Focus status access
                  </Button>
                </>
              ) : null}
            </>
          ),
        }}
      />
      {saveDefaults.isError ? (
        <Button
          variant="outline"
          onClick={() => saveDefaults.mutate({ patch: pendingDefaults.current, captured: session })}
        >
          Retry saving defaults
        </Button>
      ) : null}
      {saveDevice.isError ? (
        <Button
          variant="outline"
          onClick={() =>
            saveDevice.mutate({
              patch: pendingDevice.current,
              ...(pendingEnabled.current === undefined ? {} : { enabled: pendingEnabled.current }),
              identity: device.data ? desktopSettingsIdentity(device.data) : null,
              captured: session,
            })
          }
        >
          Retry saving card settings
        </Button>
      ) : null}
    </>
  );
}
