import { useIsMutating, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { DataViewLoading, DataViewRecovery } from "@/components/data-view-state";
import { PulseIcon } from "@/components/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { settingsPath } from "@/features/settings/settings-routes";
import { api } from "../../api.js";
import { FeedbackForm } from "../../components/feedback-form.js";
import { MutationFeedback } from "../../components/mutation-feedback.js";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "../../components/settings-field.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import {
  ColorPicker,
  ColorPickerHue,
  ColorPickerInput,
  ColorPickerSelection,
} from "../../components/ui/color-picker.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../components/ui/dialog.js";
import { Input } from "../../components/ui/input.js";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select";
import { Slider } from "../../components/ui/slider.js";
import { Switch } from "../../components/ui/switch.js";
import { WorkspaceIcon } from "../../components/workspace-identity.js";
import { SettingsFeedbackContext, useSettingsError } from "../../lib/settings-feedback.js";
import { useFeedbackMutation } from "../../lib/use-feedback-mutation.js";
import { workspaceDefinitions } from "../../navigation/manifest.js";
import { ProfileRow } from "../settings/profile-rows.js";
import { SettingsBento, SettingsSection } from "../settings/settings-layout.js";
import { RitualLocal } from "../tracking/ritual-local.js";
import { BackgroundSetup } from "./background-setup.js";
import {
  type DesktopSettings,
  type DesktopSettingsIdentity,
  desktopSettingsIdentity,
  getDesktopSettings,
  hostedServer,
  isDesktop,
  nativeAction,
  requireDesktopSettingsIdentity,
  resetDesktopConnection,
  saveDesktopSettings,
  testDesktopServer,
} from "./bridge.js";
import { resetDesktopSession } from "./session.js";
import { DesktopUpdates } from "./updates.js";
import { usePetAppearance } from "./use-pet-appearance";

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const id = useId();
  return (
    <Field orientation="horizontal">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Switch id={id} checked={value} onCheckedChange={onChange} />
    </Field>
  );
}
type DesktopSettingsPanelProps = {
  section?: "desktop" | "pet" | "notifications" | "calendar" | "tasks" | "mail" | "finances";
  connectionOnly?: boolean;
};

export function DesktopSettingsPanel(props: DesktopSettingsPanelProps) {
  return (
    <SettingsFeedbackContext.Provider value={true}>
      <DesktopSettingsPanelInner {...props} />
    </SettingsFeedbackContext.Provider>
  );
}

function DesktopSettingsPanelInner(props: DesktopSettingsPanelProps) {
  if (!isDesktop()) return null;
  if (!props.connectionOnly) return <DesktopSettingsContent {...props} />;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="self-center" type="button">
          Server settings
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Server connection</DialogTitle>
          <DialogDescription>Use hosted nohmi or connect to your own server.</DialogDescription>
        </DialogHeader>
        <DesktopSettingsContent {...props} />
      </DialogContent>
    </Dialog>
  );
}

function ConnectionFields({
  children,
}: {
  children: ReactNode;
  title: string;
  layout?: "rows" | "content";
}) {
  return <>{children}</>;
}

function DesktopSettingsContent({
  section = "desktop",
  connectionOnly = false,
}: {
  section?: "desktop" | "pet" | "notifications" | "calendar" | "tasks" | "mail" | "finances";
  connectionOnly?: boolean;
}) {
  const cache = useQueryClient();
  const startupPending = useIsMutating({ mutationKey: ["desktop-startup"] }) > 0;
  const query = useQuery({
    queryKey: ["desktop-settings"],
    queryFn: getDesktopSettings,
    refetchOnMount: "always",
    refetchInterval: 3000,
    enabled: isDesktop(),
  });
  useEffect(() => {
    if (!isDesktop()) return;
    const refresh = () => void cache.invalidateQueries({ queryKey: ["desktop-settings"] });
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [cache]);
  const [draft, setDraft] = useState<DesktopSettings | null>(null);

  const settingsIdentity = query.data ? desktopSettingsIdentity(query.data) : null;
  const save = useFeedbackMutation({
    feedback: { action: "save desktop preferences", safeToRetry: true, form: true },
    scope: { id: "desktop-preferences" },
    mutationFn: async ({
      settings,
      identity,
    }: {
      settings: DesktopSettings;
      identity: DesktopSettingsIdentity | null;
    }) => {
      if (!identity) throw new Error("Desktop settings are still loading.");
      const current = await getDesktopSettings();
      requireDesktopSettingsIdentity(current, identity);
      return saveDesktopSettings({ ...current.settings, serverUrl: settings.serverUrl }, identity);
    },
    onSuccess: async (value) => {
      const switched = query.data?.settings.serverUrl !== value.settings.serverUrl;
      resetDesktopConnection();
      if (switched) {
        setDraft(value.settings);
        await resetDesktopSession(cache);
        return;
      }
      setDraft(value.settings);
      cache.setQueryData(["desktop-settings"], value);
      toast.success("Desktop preferences saved");
    },
  });
  const revision = useRef(0);
  const appearance = usePetAppearance(
    query.data ? `${query.data.settings.serverUrl}|${query.data.accountId ?? ""}` : undefined,
    (value, savedRevision) => {
      cache.setQueryData(["desktop-settings"], value);
      if (savedRevision === revision.current)
        setDraft(
          (current) =>
            current && {
              ...current,
              petColor: value.settings.petColor,
              petScale: value.settings.petScale ?? 1,
            },
        );
    },
  );
  type SettingsPatch = Omit<Partial<DesktopSettings>, "notifications"> & {
    notifications?: Partial<DesktopSettings["notifications"]>;
  };
  const pendingSettings = useRef<SettingsPatch>({});
  // biome-ignore lint/correctness/useExhaustiveDependencies: pending edits belong only to the account and server where they were made.
  useEffect(() => {
    pendingSettings.current = {};
  }, [query.data?.settings.serverUrl, query.data?.accountId]);
  const autosave = useFeedbackMutation({
    scope: { id: "desktop-preferences" },
    feedback: { action: "save desktop preferences", safeToRetry: true },
    mutationFn: async ({
      patch,
      identity,
    }: {
      patch: SettingsPatch;
      revision: number;
      identity: DesktopSettingsIdentity | null;
    }) => {
      if (!identity) throw new Error("Desktop settings are still loading.");
      const current = await getDesktopSettings();
      requireDesktopSettingsIdentity(current, identity);
      // Scoped writes run serially. Carry failed fields into the next write so an
      // unrelated queued edit cannot silently discard the earlier desired value.
      pendingSettings.current = {
        ...pendingSettings.current,
        ...patch,
        notifications: { ...pendingSettings.current.notifications, ...patch.notifications },
      };
      return saveDesktopSettings(
        {
          ...current.settings,
          ...pendingSettings.current,
          notifications: {
            ...current.settings.notifications,
            ...pendingSettings.current.notifications,
          },
        },
        identity,
      );
    },
    onSuccess: (value, input) => {
      pendingSettings.current = {};
      cache.setQueryData(["desktop-settings"], value);
      if (input.revision === revision.current)
        setDraft((current) => ({
          ...value.settings,
          serverUrl: current?.serverUrl ?? value.settings.serverUrl,
          notifications: {
            ...value.settings.notifications,
            quietStart: current?.notifications.quietStart ?? null,
            quietEnd: current?.notifications.quietEnd ?? null,
          },
          petColor: current?.petColor ?? value.settings.petColor,
          petScale: current?.petScale ?? value.settings.petScale ?? 1,
        }));
    },
    onError: async () => {
      // Keep the desired draft and pending patch available for the next save after Sonner reports the failure.
      await query.refetch();
    },
  });
  useEffect(() => {
    if (query.data && query.isFetchedAfterMount)
      setDraft((current) => {
        if (!current) return query.data.settings;
        // Native context-menu changes must reach the switch without replacing local drafts.
        if (
          autosave.isPending ||
          pendingSettings.current.petEnabled !== undefined ||
          current.petEnabled === query.data.settings.petEnabled
        )
          return current;
        return { ...current, petEnabled: query.data.settings.petEnabled };
      });
  }, [query.data, query.isFetchedAfterMount, autosave.isPending]);
  const test = useFeedbackMutation({
    feedback: {
      action: "test the desktop connection",
      safeToRetry: true,
      form: false,
      pending: "Testing connection…",
      success: "Connection verified",
    },
    mutationFn: testDesktopServer,
  });
  const action = useFeedbackMutation({
    feedback: { action: "complete the desktop action", safeToRetry: false, form: false },
    mutationFn: nativeAction,
    onSuccess: () => cache.invalidateQueries({ queryKey: ["desktop-settings"] }),
  });
  const accessibility = useFeedbackMutation({
    feedback: {
      action: "open Accessibility settings",
      pending: "Opening Accessibility settings…",
      success: "Accessibility settings opened",
      successDescription:
        "Enable nohmi to allow precise placement beside the Dock. macOS controls this permission.",
    },
    mutationFn: () => nativeAction("request_accessibility_permission"),
    onSuccess: () => cache.invalidateQueries({ queryKey: ["desktop-settings"] }),
  });
  const testNotification = useFeedbackMutation({
    feedback: {
      action: "send the test notification",
      pending: "Sending test to macOS…",
      success: "macOS accepted the test notification.",
      successDescription:
        "If no banner appears, check Notification Center, Focus, and notification settings for screen sharing.",
    },
    mutationFn: async () => {
      await nativeAction("test_notification");
      // The native command starts submission; only its completion confirms OS acceptance.
      for (let attempt = 0; attempt < 40; attempt++) {
        const current = await getDesktopSettings();
        if (current.native.testNotificationStatus === "accepted") return;
        if (current.native.testNotificationStatus === "failed")
          throw new Error("macOS could not accept the test notification.");
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error("Could not confirm that macOS accepted the test notification.");
    },
  });
  const accounts = useQuery({
    queryKey: ["connectors", "notification-settings"],
    queryFn: api.listConnectors,
    enabled: isDesktop() && section === "mail" && !connectionOnly,
  });
  const mailboxes = useQuery({
    queryKey: ["mailboxes", "notification-settings"],
    queryFn: api.listMailboxes,
    enabled: isDesktop() && section === "mail" && !connectionOnly,
  });
  const calendars = useQuery({
    queryKey: ["calendars", "notification-settings"],
    queryFn: api.listCalendars,
    enabled: isDesktop() && section === "calendar" && !connectionOnly,
  });
  useSettingsError(query.data?.native.error, query.data?.native.error ?? "macOS needs attention.");
  useSettingsError(
    query.data?.wallpaperError,
    "Wallpaper could not refresh. nohmi will retry while it is running.",
  );
  useSettingsError(
    query.data?.mailError,
    "Couldn’t refresh mail notifications. Check your connection.",
  );
  if (!isDesktop()) return null;
  if (query.isPending) return <DataViewLoading label="Loading desktop preferences" />;
  if (query.error && !query.data)
    return (
      <DataViewRecovery
        query={query}
        title="Couldn’t load desktop preferences."
        unavailableLabel="Desktop preferences unavailable"
      />
    );
  if (!draft) return null;
  const update = (value: Partial<DesktopSettings>) => {
    setDraft({ ...draft, ...value });
    if (!("serverUrl" in value))
      autosave.mutate({ identity: settingsIdentity, patch: value, revision: ++revision.current });
  };
  const usesHostedServer = draft.serverUrl === hostedServer;
  const notification = (value: Partial<DesktopSettings["notifications"]>) => {
    setDraft({ ...draft, notifications: { ...draft.notifications, ...value } });
    autosave.mutate({
      identity: settingsIdentity,
      patch: { notifications: value },
      revision: ++revision.current,
    });
  };

  const quietHours = (
    value: Partial<Pick<DesktopSettings["notifications"], "quietStart" | "quietEnd">>,
  ) => {
    const next = { ...draft.notifications, ...value };
    setDraft({ ...draft, notifications: next });
    const nextRevision = ++revision.current;
    if ((next.quietStart === null) === (next.quietEnd === null))
      autosave.mutate({
        identity: settingsIdentity,
        patch: { notifications: { quietStart: next.quietStart, quietEnd: next.quietEnd } },
        revision: nextRevision,
      });
  };

  const Group = connectionOnly ? ConnectionFields : SettingsSection;
  const background = query.data?.native.loginStatus ? (
    <BackgroundSetup
      status={query.data}
      stale={query.isError}
      saving={autosave.isPending || save.isPending}
      dirty={draft.serverUrl !== query.data.settings.serverUrl}
      section={section}
      onStartupEnabled={() => setDraft((current) => current && { ...current, launchAtLogin: true })}
    />
  ) : null;
  return (
    <div className="settings-stack min-w-0">
      {connectionOnly ? <RitualLocal recoveryOnly /> : null}
      <MutationFeedback feedback={autosave.feedback} />
      <DataViewRecovery
        query={query}
        title="Couldn’t refresh desktop preferences."
        unavailableLabel="Desktop preferences unavailable"
      />
      <FeedbackForm
        feedback={save.feedback}
        className="settings-stack min-w-0"
        onSubmit={(event) => {
          event.preventDefault();
          if (
            section === "desktop" &&
            !startupPending &&
            draft.serverUrl !== query.data?.settings.serverUrl
          )
            save.mutate({ settings: draft, identity: settingsIdentity });
        }}
      >
        {section === "desktop" ? (
          <>
            {!connectionOnly ? (
              <SettingsBento primaryFirst>
                <SettingsSection layout="rows" title="Background activity">
                  <Toggle
                    label="Open at login"
                    value={draft.launchAtLogin}
                    onChange={(launchAtLogin) => update({ launchAtLogin })}
                  />
                  {background}
                </SettingsSection>
                <SettingsSection layout="rows" title="Widgets">
                  <FieldGroup>
                    {["tasks", "reminders", "calendar", "finances", "mail", "goals", "motives"].map(
                      (workspace) => (
                        <Field orientation="horizontal" key={workspace}>
                          <Switch
                            id={`widget-${workspace}`}
                            checked={draft.widgetWorkspaces.includes(workspace)}
                            onCheckedChange={(checked) =>
                              update({
                                widgetWorkspaces: checked
                                  ? [...draft.widgetWorkspaces, workspace]
                                  : draft.widgetWorkspaces.filter((value) => value !== workspace),
                              })
                            }
                          />
                          <FieldLabel htmlFor={`widget-${workspace}`}>
                            {`${workspace[0]?.toUpperCase()}${workspace.slice(1)}`}
                          </FieldLabel>
                        </Field>
                      ),
                    )}
                  </FieldGroup>
                  <p className="px-4 py-3 text-xs text-muted-foreground">
                    {query.data?.native.widgetsAvailable
                      ? "Native widgets are available through Edit Widgets on your desktop."
                      : "Native widgets require an installed build with App Group access."}
                  </p>
                </SettingsSection>
              </SettingsBento>
            ) : null}
            <Group title="Server connection" layout="rows">
              <FieldGroup>
                <Field>
                  <FieldLabel>
                    Hosted nohmi <Badge variant="secondary">Recommended</Badge>
                  </FieldLabel>
                  <FieldDescription>nohmi-api.coopersully.me</FieldDescription>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {usesHostedServer ? (
                      <Badge variant="secondary">Selected</Badge>
                    ) : (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => update({ serverUrl: hostedServer })}
                      >
                        Use hosted nohmi
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={test.isPending}
                      onClick={() => test.mutate(hostedServer)}
                    >
                      {test.isPending ? "Testing hosted…" : "Test hosted connection"}
                    </Button>
                  </div>
                </Field>
                <Field>
                  <FieldLabel htmlFor="desktop-server">Custom API server</FieldLabel>
                  <FieldDescription>
                    Use an HTTPS origin. Switching servers signs you out.
                  </FieldDescription>
                  <Input
                    id="desktop-server"
                    type="url"
                    value={usesHostedServer ? "" : draft.serverUrl}
                    onChange={(event) => update({ serverUrl: event.target.value })}
                    placeholder="https://nohmi-api.example.com"
                    required={!usesHostedServer}
                  />
                </Field>
                <div className="flex flex-wrap justify-end gap-2 px-4 py-3">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={test.isPending || usesHostedServer || !draft.serverUrl}
                    onClick={() => test.mutate(draft.serverUrl)}
                  >
                    {test.isPending ? "Testing…" : "Test connection"}
                  </Button>
                  <Button
                    type="submit"
                    disabled={
                      save.isPending ||
                      startupPending ||
                      draft.serverUrl === query.data?.settings.serverUrl
                    }
                  >
                    {save.isPending ? "Connecting…" : "Connect to server"}
                  </Button>
                </div>
              </FieldGroup>
            </Group>
          </>
        ) : null}
        {section === "pet" ? (
          <SettingsSection layout="rows" title="Companion">
            <FieldGroup>
              <Toggle
                label="Show desktop pet"
                value={draft.petEnabled}
                onChange={(petEnabled) => update({ petEnabled })}
              />
              <Field>
                <FieldLabel>Pet color</FieldLabel>
                <Popover
                  onOpenChange={(open) => {
                    if (!open) appearance.commit();
                  }}
                >
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      className="gap-2 font-normal text-muted-foreground"
                      aria-label="Edit Pet color"
                    >
                      <span
                        aria-hidden="true"
                        className="size-4 rounded-full border border-border"
                        style={{ backgroundColor: draft.petColor }}
                      />
                      {draft.petColor.toUpperCase()}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    className="w-64 max-w-[calc(100vw-2rem)]"
                    aria-label="Pet color editor"
                  >
                    <ColorPicker
                      value={draft.petColor}
                      onChange={(petColor) => {
                        setDraft((current) => current && { ...current, petColor });
                        appearance.change({
                          color: petColor,
                          scale: draft.petScale ?? 1,
                          revision: ++revision.current,
                        });
                      }}
                      onPointerUp={() => appearance.commit()}
                      onBlur={() => appearance.commit()}
                      className="w-full max-w-sm"
                    >
                      <ColorPickerSelection />
                      <ColorPickerHue />
                      <ColorPickerInput id="pet-color" aria-label="Pet color" />
                    </ColorPicker>
                  </PopoverContent>
                </Popover>
              </Field>
              <Field>
                <FieldLabel htmlFor="pet-scale">
                  Pet scale · {Math.round((draft.petScale ?? 1) * 100)}%
                </FieldLabel>
                <Slider
                  id="pet-scale"
                  aria-label="Pet scale"
                  aria-valuetext={`${Math.round((draft.petScale ?? 1) * 100)}%`}
                  min={50}
                  max={200}
                  step={5}
                  value={[(draft.petScale ?? 1) * 100]}
                  onValueChange={([percent]) => {
                    if (percent === undefined) return;
                    setDraft((current) => current && { ...current, petScale: percent / 100 });
                    appearance.change({
                      color: draft.petColor,
                      scale: percent / 100,
                      revision: ++revision.current,
                    });
                  }}
                  onValueCommit={() => appearance.commit()}
                />
                <FieldDescription>
                  Preview the size as you drag. Your choice saves when you release.
                </FieldDescription>
              </Field>

              <Button
                type="button"
                variant="outline"
                className="self-start"
                onClick={() => action.mutate("reset_pet_position")}
              >
                Reset pet position
              </Button>
              <FieldDescription className="px-4 py-3">
                Animation follows your macOS Reduce Motion preference.
              </FieldDescription>
            </FieldGroup>
          </SettingsSection>
        ) : null}
        {section === "pet" ? (
          <SettingsSection layout="rows" title="Show in quick access">
            <FieldGroup>
              {["tasks", "reminders", "calendar", "finances"].map((workspace) => (
                <Toggle
                  key={workspace}
                  label={`${workspace[0]?.toUpperCase()}${workspace.slice(1)}`}
                  value={draft.petWorkspaces.includes(workspace)}
                  onChange={(checked) =>
                    update({
                      petWorkspaces: checked
                        ? [...draft.petWorkspaces, workspace]
                        : draft.petWorkspaces.filter((value) => value !== workspace),
                    })
                  }
                />
              ))}
            </FieldGroup>
          </SettingsSection>
        ) : null}
        {section === "pet" ? (
          <SettingsSection layout="rows" title="Sleep">
            <FieldGroup>
              <Toggle
                label="Sleep when idle"
                value={draft.petSleepEnabled ?? true}
                onChange={(petSleepEnabled) => update({ petSleepEnabled })}
              />
              <Field>
                <FieldLabel htmlFor="pet-sleep-delay">
                  Sleep after · {draft.petSleepAfterSeconds ?? 3} seconds
                </FieldLabel>
                <Slider
                  id="pet-sleep-delay"
                  aria-label="Sleep after"
                  min={1}
                  max={300}
                  step={1}
                  disabled={draft.petSleepEnabled === false}
                  value={[draft.petSleepAfterSeconds ?? 3]}
                  onValueChange={([seconds]) => {
                    if (seconds !== undefined)
                      setDraft(
                        (current) => current && { ...current, petSleepAfterSeconds: seconds },
                      );
                  }}
                  onValueCommit={([seconds]) => {
                    if (seconds !== undefined) update({ petSleepAfterSeconds: seconds });
                  }}
                />
                <FieldDescription>
                  At an anchor with the card closed, tuck into the screen edge after this much
                  inactivity. Hover or click to wake.
                </FieldDescription>
              </Field>
            </FieldGroup>
          </SettingsSection>
        ) : null}
        {section === "pet" ? (
          <SettingsSection layout="rows" title="Quick access content">
            <FieldGroup>
              <Toggle
                label="Show rituals"
                value={draft.petShowRituals ?? false}
                onChange={(petShowRituals) => update({ petShowRituals })}
              />
              {(["tasks", "reminders"] as const).map((kind) => {
                const key = kind === "tasks" ? "petTaskWindow" : "petReminderWindow";
                const overdueKey =
                  kind === "tasks" ? "petTasksIncludeOverdue" : "petRemindersIncludeOverdue";
                return (
                  <FieldGroup key={kind}>
                    <Field>
                      <FieldLabel htmlFor={`pet-${kind}-window`}>
                        {kind === "tasks" ? "Tasks" : "Reminders"}
                      </FieldLabel>
                      <NativeSelect
                        id={`pet-${kind}-window`}
                        value={draft[key] ?? "today"}
                        onChange={(event) => update({ [key]: event.target.value })}
                      >
                        {[
                          ["today", "Today"],
                          ["week", "This week"],
                          ["month", "This month"],
                          ["next7", "Next 7 days"],
                          ["next30", "Next 30 days"],
                          ["allUpcoming", "All upcoming"],
                        ].map(([value, label]) => (
                          <NativeSelectOption key={value} value={value}>
                            {label}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </Field>
                    <Toggle
                      label={`Include overdue ${kind}`}
                      value={draft[overdueKey] ?? true}
                      onChange={(value) => update({ [overdueKey]: value })}
                    />
                  </FieldGroup>
                );
              })}
              <Field>
                <FieldLabel htmlFor="pet-finance-window">Finances</FieldLabel>
                <NativeSelect
                  id="pet-finance-window"
                  value={draft.petFinanceWindow ?? "month"}
                  onChange={(event) =>
                    update({
                      petFinanceWindow: event.target.value as NonNullable<
                        DesktopSettings["petFinanceWindow"]
                      >,
                    })
                  }
                >
                  {[
                    ["today", "Today"],
                    ["week", "This week"],
                    ["month", "This month"],
                    ["last30", "Last 30 days"],
                  ].map(([value, label]) => (
                    <NativeSelectOption key={value} value={value}>
                      {label}
                    </NativeSelectOption>
                  ))}
                  <NativeSelectOption value="next30" disabled>
                    Next 30 days · unavailable
                  </NativeSelectOption>
                </NativeSelect>
                <FieldDescription>
                  Posted spending through today. Scheduled outflows are not yet available in quick
                  access.
                </FieldDescription>
              </Field>
            </FieldGroup>
          </SettingsSection>
        ) : null}
        {section === "pet" ? (
          <SettingsSection layout="rows" title="Shoo">
            <FieldGroup>
              <Toggle
                label="Shake to shoo"
                value={draft.petShooEnabled ?? false}
                onChange={(petShooEnabled) => update({ petShooEnabled })}
              />
              <FieldDescription className="px-4 py-2">
                Shake the pointer over the pet to move it to the farthest available anchor. Only
                works with the card closed.
              </FieldDescription>
              <Field>
                <FieldLabel htmlFor="pet-shoo-sensitivity">Sensitivity</FieldLabel>
                <NativeSelect
                  id="pet-shoo-sensitivity"
                  value={draft.petShooSensitivity ?? "medium"}
                  disabled={!draft.petShooEnabled}
                  onChange={(event) =>
                    update({ petShooSensitivity: event.target.value as "low" | "medium" | "high" })
                  }
                >
                  <NativeSelectOption value="low">Low · deliberate, wide shakes</NativeSelectOption>
                  <NativeSelectOption value="medium">
                    Medium · several clear shakes
                  </NativeSelectOption>
                  <NativeSelectOption value="high">High · smaller shakes</NativeSelectOption>
                </NativeSelect>
              </Field>
            </FieldGroup>
          </SettingsSection>
        ) : null}
        {section === "pet" && query.data?.native.accessibilityPermission !== undefined ? (
          <SettingsSection layout="rows" title="Dock placement">
            <FieldGroup className="p-4">
              <FieldDescription>
                Allow Accessibility access so nohmi can measure the Dock and use the space beside
                it. nohmi reads only Dock geometry. Widgets can be overlapped; the pet stays above
                them.
              </FieldDescription>
              <FieldDescription>
                {query.data.native.accessibilityPermission
                  ? query.data.native.dockGeometryAvailable
                    ? "Accessibility allowed · Dock geometry available"
                    : "Accessibility allowed · Waiting for Dock geometry"
                  : "Accessibility not enabled · Placement stays above the Dock’s reserved area"}
              </FieldDescription>
              <Button
                type="button"
                variant="outline"
                className="self-start"
                disabled={accessibility.isPending}
                onClick={() => accessibility.mutate()}
              >
                Open Accessibility settings
              </Button>
            </FieldGroup>
          </SettingsSection>
        ) : null}
        {section === "notifications" ? (
          <SettingsSection
            layout="rows"
            title="Desktop notifications"
            icon={<PulseIcon />}
            description="Notifications work with the window closed and the pet disabled. macOS Focus and notification settings control presentation."
            headerContent={
              <div className="flex flex-col gap-2 pt-2">
                <p role="status">
                  macOS permission:{" "}
                  {query.data?.native.notificationPermission === "notDetermined"
                    ? "Not requested"
                    : (query.data?.native.notificationPermission ?? "unavailable")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {query.data?.native.notificationPermission === "denied"
                    ? "Notifications are blocked. Open macOS notification settings and allow nohmi, then return here."
                    : query.data?.native.notificationPermission === "authorized" &&
                        query.data?.native.notificationAlertsAvailable === false
                      ? "macOS alerts are off. Enable banners or alerts in notification settings."
                      : query.data?.native.notificationPermission === "authorized"
                        ? "Notifications are allowed. macOS Focus and screen-sharing settings may silence tests."
                        : "Allow notifications to receive alerts from nohmi, then send a test."}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={
                      action.isPending ||
                      query.data?.native.notificationPermissionPending ||
                      query.data?.native.notificationPermission === "authorized"
                    }
                    onClick={() =>
                      action.mutate(
                        query.data?.native.notificationPermission === "denied"
                          ? "open_notification_settings"
                          : "request_notification_permission",
                      )
                    }
                  >
                    {query.data?.native.notificationPermissionPending
                      ? "Waiting for macOS…"
                      : query.data?.native.notificationPermission === "authorized"
                        ? "Notifications allowed"
                        : query.data?.native.notificationPermission === "denied"
                          ? "Allow in macOS settings"
                          : "Allow notifications"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => action.mutate("open_notification_settings")}
                  >
                    macOS notification settings
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={
                      action.isPending ||
                      testNotification.isPending ||
                      query.data?.native.notificationPermission !== "authorized" ||
                      query.data?.native.notificationPermissionPending
                    }
                    onClick={() => testNotification.mutate()}
                  >
                    Test notification
                  </Button>
                </div>
                {draft.notifications.sound &&
                query.data?.native.notificationSoundsAvailable === false &&
                query.data?.native.notificationPermission === "authorized" ? (
                  <p className="text-xs text-muted-foreground">
                    Sounds are disabled in macOS. Enable “Play sound for notification” in macOS
                    notification settings to hear the soft click.
                  </p>
                ) : null}
              </div>
            }
          >
            <FieldGroup>
              <Toggle
                label="Enable notifications"
                value={draft.notifications.enabled}
                onChange={(enabled) => notification({ enabled })}
              />
              <Toggle
                label="Play notification sounds"
                value={draft.notifications.sound}
                onChange={(sound) => notification({ sound })}
              />
              <Toggle
                label="Show message previews"
                value={draft.notifications.preview}
                onChange={(preview) => notification({ preview })}
              />
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="quiet-start">Quiet hours start</FieldLabel>
                  <Input
                    id="quiet-start"
                    type="time"
                    value={draft.notifications.quietStart ?? ""}
                    onChange={(event) => quietHours({ quietStart: event.target.value || null })}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="quiet-end">Quiet hours end</FieldLabel>
                  <Input
                    id="quiet-end"
                    type="time"
                    value={draft.notifications.quietEnd ?? ""}
                    onChange={(event) => quietHours({ quietEnd: event.target.value || null })}
                  />
                </Field>
              </FieldGroup>
            </FieldGroup>
          </SettingsSection>
        ) : null}
        {["tasks", "calendar", "mail", "finances"].includes(section) ? (
          <SettingsSection layout="rows" title="Notifications">
            <FieldGroup>
              {section === "tasks" ? (
                <>
                  {" "}
                  <Toggle
                    label="Tasks due"
                    value={draft.notifications.tasks}
                    onChange={(tasks) => notification({ tasks })}
                  />
                  <Toggle
                    label="Reminders due"
                    value={draft.notifications.reminders}
                    onChange={(reminders) => notification({ reminders })}
                  />
                </>
              ) : null}
              {section === "calendar" ? (
                <>
                  {" "}
                  <Toggle
                    label="Upcoming events"
                    value={draft.notifications.calendar}
                    onChange={(calendar) => notification({ calendar })}
                  />
                  <Field>
                    <FieldLabel htmlFor="event-notice">Minutes before an event</FieldLabel>
                    <Input
                      id="event-notice"
                      type="number"
                      min={0}
                      max={1440}
                      value={draft.notifications.advanceMinutes}
                      onChange={(event) =>
                        notification({ advanceMinutes: Number(event.target.value) })
                      }
                    />
                  </Field>
                  <FieldSet>
                    <FieldLegend>Calendar selection</FieldLegend>
                    <FieldDescription>No selection uses all selected calendars.</FieldDescription>
                    {calendars.data?.map((calendar) => (
                      <Field orientation="horizontal" key={calendar.id}>
                        <Switch
                          id={`notify-calendar-${calendar.id}`}
                          checked={draft.notifications.calendarIds.includes(calendar.id)}
                          onCheckedChange={(checked) =>
                            notification({
                              calendarIds: checked
                                ? [...draft.notifications.calendarIds, calendar.id]
                                : draft.notifications.calendarIds.filter(
                                    (id) => id !== calendar.id,
                                  ),
                            })
                          }
                        />
                        <FieldLabel htmlFor={`notify-calendar-${calendar.id}`}>
                          {calendar.name}
                        </FieldLabel>
                      </Field>
                    ))}
                  </FieldSet>
                  <DataViewRecovery
                    query={calendars}
                    title="Couldn’t load calendars."
                    unavailableLabel="Calendars unavailable"
                  />
                </>
              ) : null}
              {section === "mail" ? (
                <>
                  {" "}
                  <Toggle
                    label="New mail"
                    value={draft.notifications.mail}
                    onChange={(mail) => notification({ mail })}
                  />
                  <FieldSet>
                    <FieldLegend>Mail accounts</FieldLegend>
                    {[...new Set(mailboxes.data?.map((mailbox) => mailbox.accountId) ?? [])].map(
                      (accountId, index) => (
                        <Field orientation="horizontal" key={accountId}>
                          <Switch
                            id={`notify-mail-${accountId}`}
                            checked={draft.notifications.mailAccountIds.includes(accountId)}
                            onCheckedChange={(checked) =>
                              notification({
                                mailAccountIds: checked
                                  ? [...draft.notifications.mailAccountIds, accountId]
                                  : draft.notifications.mailAccountIds.filter(
                                      (id) => id !== accountId,
                                    ),
                              })
                            }
                          />
                          <FieldLabel htmlFor={`notify-mail-${accountId}`}>
                            {accounts.data?.find((account) => account.id === accountId)?.email ??
                              `Mail account ${index + 1}`}
                          </FieldLabel>
                        </Field>
                      ),
                    )}
                    <DataViewRecovery
                      query={mailboxes}
                      title="Couldn’t load mail accounts."
                      unavailableLabel="Mail accounts unavailable"
                    />
                    <DataViewRecovery
                      query={accounts}
                      title="Couldn’t load connected accounts."
                      unavailableLabel="Connected accounts unavailable"
                    />
                    {accounts.data
                      ?.filter((account) => account.syncError)
                      .map((account) => (
                        <p role="status" key={account.id}>
                          {account.email}: Sync needs attention. Check Connections to reconnect.
                        </p>
                      ))}
                  </FieldSet>
                </>
              ) : null}
              {section === "finances" ? (
                <FieldDescription>
                  Desktop alerts for Finances are not available yet.
                </FieldDescription>
              ) : null}
            </FieldGroup>
          </SettingsSection>
        ) : null}
      </FeedbackForm>
      {section === "notifications" ? (
        <SettingsSection layout="rows" title="Workspace notifications">
          <div>
            {workspaceDefinitions
              .filter((workspace) => workspace.id !== "today")
              .map((workspace) => (
                <ProfileRow
                  key={workspace.id}
                  label={workspace.label}
                  icon={
                    workspace.id !== "today" ? (
                      <WorkspaceIcon workspace={workspace.id} size="sm" />
                    ) : null
                  }
                  to={`${settingsPath(workspace.id)}&field=${workspace.id}:notifications`}
                />
              ))}
          </div>
        </SettingsSection>
      ) : null}
      {section === "pet" && background ? (
        <SettingsSection layout="rows" title="Background activity">
          {background}
        </SettingsSection>
      ) : null}
      {!connectionOnly && section === "desktop" ? <DesktopUpdates /> : null}
    </div>
  );
}
