import { useIsMutating, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { api } from "../../api.js";
import { QueryFeedback } from "../../components/async-state.js";
import { FeedbackForm } from "../../components/feedback-form.js";
import { MutationFeedback } from "../../components/mutation-feedback.js";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Checkbox } from "../../components/ui/checkbox.js";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../components/ui/collapsible.js";
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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "../../components/ui/field.js";
import { Input } from "../../components/ui/input.js";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "../../components/ui/item.js";
import { Slider } from "../../components/ui/slider.js";
import { Switch } from "../../components/ui/switch.js";
import { WorkspaceIcon } from "../../components/workspace-identity.js";
import { SettingsFeedbackContext, useSettingsError } from "../../lib/settings-feedback.js";
import { useFeedbackMutation } from "../../lib/use-feedback-mutation.js";
import { workspaceDefinitions } from "../../navigation/manifest.js";
import { SettingsBento, SettingsSection } from "../settings/settings-layout.js";
import { RitualLocal } from "../tracking/ritual-local.js";
import { BackgroundSetup } from "./background-setup.js";
import {
  type DesktopSettings,
  getDesktopSettings,
  hostedServer,
  isDesktop,
  nativeAction,
  previewPetScale,
  resetDesktopConnection,
  saveDesktopSettings,
  testDesktopServer,
} from "./bridge.js";
import { resetDesktopSession } from "./session.js";
import { DesktopUpdates } from "./updates.js";

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

function ConnectionFields({ children }: { children: ReactNode; title: string }) {
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
  const [tested, setTested] = useState<string | null>(null);
  const [advancedServerOpen, setAdvancedServerOpen] = useState(false);
  useEffect(() => {
    if (query.data && query.isFetchedAfterMount)
      setDraft((current) => current ?? query.data.settings);
  }, [query.data, query.isFetchedAfterMount]);
  useEffect(() => {
    if (query.data && query.data.settings.serverUrl !== hostedServer) setAdvancedServerOpen(true);
  }, [query.data]);
  const save = useFeedbackMutation({
    feedback: { action: "save desktop preferences", safeToRetry: true, form: true },
    scope: { id: "desktop-preferences" },
    mutationFn: async (settings: DesktopSettings) => {
      const current = await getDesktopSettings();
      return saveDesktopSettings({ ...current.settings, serverUrl: settings.serverUrl });
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
  const scaleFrame = useRef<number | null>(null);
  const scalePreview = useFeedbackMutation({
    feedback: { action: "preview pet scale" },
    mutationFn: previewPetScale,
  });
  useEffect(
    () => () => {
      if (scaleFrame.current !== null) cancelAnimationFrame(scaleFrame.current);
    },
    [],
  );
  const revision = useRef(0);
  const autosave = useFeedbackMutation({
    scope: { id: "desktop-preferences" },
    feedback: { action: "save desktop preferences", safeToRetry: true },
    mutationFn: async ({
      patch,
    }: {
      patch: Omit<Partial<DesktopSettings>, "notifications"> & {
        notifications?: Partial<DesktopSettings["notifications"]>;
      };
      revision: number;
    }) => {
      const current = await getDesktopSettings();
      return saveDesktopSettings({
        ...current.settings,
        ...patch,
        notifications: { ...current.settings.notifications, ...patch.notifications },
      });
    },
    onSuccess: (value, input) => {
      cache.setQueryData(["desktop-settings"], value);
      if (input.revision === revision.current)
        setDraft((current) => ({
          ...value.settings,
          serverUrl: current?.serverUrl ?? value.settings.serverUrl,
        }));
    },
    onError: async (_error, input) => {
      const current = await query.refetch();
      if (input.revision === revision.current && current.data) setDraft(current.data.settings);
    },
  });
  const test = useFeedbackMutation({
    feedback: { action: "test the desktop connection", safeToRetry: true, form: false },
    mutationFn: testDesktopServer,
    onSuccess: (_, server) => setTested(server),
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
    query.data?.mailError,
    "Couldn’t refresh mail notifications. Check your connection.",
  );
  if (!isDesktop()) return null;
  if (query.isPending) return <p role="status">Loading desktop preferences…</p>;
  if (query.error && !query.data)
    return <QueryFeedback query={query} title="Couldn’t load desktop preferences. Try again." />;
  if (!draft) return null;
  const update = (value: Partial<DesktopSettings>) => {
    setDraft({ ...draft, ...value });
    if (!("serverUrl" in value)) autosave.mutate({ patch: value, revision: ++revision.current });
  };
  const usesHostedServer = draft.serverUrl === hostedServer;
  const notification = (value: Partial<DesktopSettings["notifications"]>) => {
    setDraft({ ...draft, notifications: { ...draft.notifications, ...value } });
    autosave.mutate({ patch: { notifications: value }, revision: ++revision.current });
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
      {query.data?.native.error ? (
        <Alert variant="destructive">
          <AlertTitle>macOS needs attention</AlertTitle>
          <AlertDescription>
            Check macOS permissions and reconnect the desktop app.
          </AlertDescription>
        </Alert>
      ) : null}
      <MutationFeedback feedback={autosave.feedback} />
      <QueryFeedback query={query} title="Couldn’t refresh desktop preferences." staleOnly />
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
            save.mutate(draft);
        }}
      >
        {section === "desktop" ? (
          <>
            {!connectionOnly ? (
              <SettingsBento primaryFirst>
                <SettingsSection title="Background activity">
                  <Toggle
                    label="Open at login"
                    value={draft.launchAtLogin}
                    onChange={(launchAtLogin) => update({ launchAtLogin })}
                  />
                  {query.data?.wallpaperError ? (
                    <p role="alert">
                      Wallpaper could not refresh. nohmi will retry while it is running.
                    </p>
                  ) : null}
                  {background}
                </SettingsSection>
                <SettingsSection title="Widgets">
                  <FieldSet>
                    <FieldLegend>Widget workspaces</FieldLegend>
                    <FieldDescription>
                      Choose what can appear in Today at a Glance, independently of the pet.
                    </FieldDescription>
                    {["tasks", "reminders", "calendar", "finances", "mail", "goals", "motives"].map(
                      (workspace) => (
                        <Field orientation="horizontal" key={workspace}>
                          <Checkbox
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
                  </FieldSet>
                  <p>
                    {query.data?.native.widgetsAvailable
                      ? "Native widgets are available through Edit Widgets on your desktop."
                      : "Native widgets require an installed build with App Group access."}
                  </p>
                </SettingsSection>
              </SettingsBento>
            ) : null}
            <Group title="Server connection">
              <FieldGroup>
                <ItemGroup>
                  <Item variant="secondary" className="flex-col items-stretch">
                    <ItemContent>
                      <ItemTitle>
                        Hosted nohmi <Badge variant="secondary">Recommended</Badge>
                      </ItemTitle>
                      <ItemDescription>nohmi-api.coopersully.me</ItemDescription>
                    </ItemContent>
                    <ItemActions className="flex-wrap">
                      {usesHostedServer ? (
                        <Badge variant="secondary">Selected</Badge>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            update({ serverUrl: hostedServer });
                            setTested(null);
                          }}
                        >
                          Use hosted nohmi
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={test.isPending}
                        onClick={() => test.mutate(hostedServer)}
                      >
                        {test.isPending ? "Testing hosted…" : "Test hosted connection"}
                      </Button>
                    </ItemActions>
                  </Item>
                </ItemGroup>
                {tested === hostedServer ? <p role="status">Hosted connection verified</p> : null}
                <Collapsible open={advancedServerOpen} onOpenChange={setAdvancedServerOpen}>
                  <CollapsibleTrigger asChild>
                    <Button type="button" variant="ghost" aria-expanded={advancedServerOpen}>
                      Advanced server settings
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-3">
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor="desktop-server">Custom API server</FieldLabel>
                        <Input
                          id="desktop-server"
                          value={usesHostedServer ? "" : draft.serverUrl}
                          onChange={(event) => {
                            update({ serverUrl: event.target.value });
                            setTested(null);
                          }}
                          placeholder="https://nohmi-api.example.com"
                          type="url"
                          required={!usesHostedServer}
                        />
                        <FieldDescription>
                          Use the HTTPS origin of a self-hosted nohmi API. Switching servers signs
                          you out.
                        </FieldDescription>
                      </Field>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={test.isPending || usesHostedServer || !draft.serverUrl}
                        onClick={() => test.mutate(draft.serverUrl)}
                      >
                        {test.isPending ? "Testing…" : "Test connection"}
                      </Button>
                      {tested === draft.serverUrl && !usesHostedServer ? (
                        <p role="status">Connection verified</p>
                      ) : null}
                    </FieldGroup>
                  </CollapsibleContent>
                </Collapsible>
              </FieldGroup>
            </Group>
          </>
        ) : null}
        {section === "pet" ? (
          <SettingsSection title="Companion">
            <FieldGroup>
              <Toggle
                label="Show desktop pet"
                value={draft.petEnabled}
                onChange={(petEnabled) => update({ petEnabled })}
              />
              <Field>
                <FieldLabel htmlFor="pet-color">Pet color</FieldLabel>
                <ColorPicker
                  value={draft.petColor}
                  onChange={(petColor) => update({ petColor })}
                  className="w-full max-w-sm"
                >
                  <ColorPickerSelection />
                  <ColorPickerHue />
                  <ColorPickerInput id="pet-color" aria-label="Pet color" />
                </ColorPicker>
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
                    revision.current += 1;
                    setDraft((current) => current && { ...current, petScale: percent / 100 });
                    if (scaleFrame.current !== null) cancelAnimationFrame(scaleFrame.current);
                    scaleFrame.current = requestAnimationFrame(() => {
                      scaleFrame.current = null;
                      scalePreview.mutate(percent / 100);
                    });
                  }}
                  onValueCommit={([percent]) => {
                    if (scaleFrame.current !== null) cancelAnimationFrame(scaleFrame.current);
                    scaleFrame.current = null;
                    if (percent !== undefined) update({ petScale: percent / 100 });
                  }}
                />
                <FieldDescription>
                  Preview the size as you drag. Your choice saves when you release.
                </FieldDescription>
              </Field>
              <FieldSet>
                <FieldLegend>Show in quick access</FieldLegend>
                {["tasks", "reminders", "calendar", "mail", "finances", "goals", "motives"].map(
                  (workspace) => (
                    <Field orientation="horizontal" key={workspace}>
                      <Checkbox
                        id={`pet-${workspace}`}
                        checked={draft.petWorkspaces.includes(workspace)}
                        onCheckedChange={(checked) =>
                          update({
                            petWorkspaces: checked
                              ? [...draft.petWorkspaces, workspace]
                              : draft.petWorkspaces.filter((value) => value !== workspace),
                          })
                        }
                      />
                      <FieldLabel htmlFor={`pet-${workspace}`}>
                        {`${workspace[0]?.toUpperCase()}${workspace.slice(1)}`}
                      </FieldLabel>
                    </Field>
                  ),
                )}
              </FieldSet>
              <Button
                type="button"
                variant="outline"
                className="self-start"
                onClick={() => action.mutate("reset_pet_position")}
              >
                Reset pet position
              </Button>
              <FieldDescription>
                Animation follows your macOS Reduce Motion preference.
              </FieldDescription>
            </FieldGroup>
          </SettingsSection>
        ) : null}
        {section === "pet" ? (
          <SettingsSection title="Sleep">
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
        {section === "pet" && query.data?.native.accessibilityPermission !== undefined ? (
          <SettingsSection title="Dock placement">
            <FieldGroup>
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
          <SettingsSection title="Desktop notifications">
            <FieldGroup>
              <p role="status">
                macOS permission: {query.data?.native.notificationPermission ?? "unavailable"}
              </p>
              <FieldDescription>
                {query.data?.native.notificationPermission === "denied"
                  ? "Notifications are blocked. Open macOS notification settings and allow nohmi, then return here."
                  : query.data?.native.notificationAlertsAvailable === false
                    ? "macOS alerts are off. Enable banners or alerts in notification settings."
                    : query.data?.native.notificationPermission === "authorized"
                      ? "Notifications are allowed. macOS Focus and screen-sharing settings may silence tests."
                      : "Allow notifications to receive alerts from nohmi, then send a test."}
              </FieldDescription>
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
                <FieldDescription>
                  Sounds are disabled in macOS. Enable “Play sound for notification” in macOS
                  notification settings to hear the soft click.
                </FieldDescription>
              ) : null}
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
              <FieldSet>
                <FieldLegend>Quiet hours</FieldLegend>
                <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="quiet-start">From</FieldLabel>
                    <Input
                      id="quiet-start"
                      type="time"
                      value={draft.notifications.quietStart ?? ""}
                      onChange={(event) => notification({ quietStart: event.target.value || null })}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="quiet-end">Until</FieldLabel>
                    <Input
                      id="quiet-end"
                      type="time"
                      value={draft.notifications.quietEnd ?? ""}
                      onChange={(event) => notification({ quietEnd: event.target.value || null })}
                    />
                  </Field>
                </div>
              </FieldSet>
              <FieldDescription>
                Notifications work with the window closed and the pet disabled. macOS Focus and
                notification settings control presentation.
              </FieldDescription>
            </FieldGroup>
          </SettingsSection>
        ) : null}
        {section === "desktop" ? (
          <Button
            className="self-start"
            type="submit"
            disabled={
              save.isPending || startupPending || draft.serverUrl === query.data?.settings.serverUrl
            }
          >
            {save.isPending ? "Connecting…" : "Connect to server"}
          </Button>
        ) : null}
        {["tasks", "calendar", "mail", "finances"].includes(section) ? (
          <SettingsSection title="Notifications">
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
                        <Checkbox
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
                  <QueryFeedback query={calendars} title="Couldn’t load calendars." />
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
                          <Checkbox
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
                    <QueryFeedback query={mailboxes} title="Couldn’t load mail accounts." />
                    <QueryFeedback query={accounts} title="Couldn’t load connected accounts." />
                    {query.data?.mailError ? (
                      <p role="alert">
                        Mail notifications could not refresh. nohmi will retry while running.
                      </p>
                    ) : null}
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
        <SettingsSection title="Workspace notifications">
          <ItemGroup>
            {workspaceDefinitions
              .filter((workspace) => workspace.id !== "today")
              .map((workspace) => (
                <Item variant="secondary" key={workspace.id} asChild>
                  <Link
                    to={`/settings?section=${workspace.id}&field=${workspace.id}:notifications`}
                  >
                    {workspace.id !== "today" ? (
                      <WorkspaceIcon workspace={workspace.id} size="sm" />
                    ) : null}
                    <ItemContent>
                      <ItemTitle>{workspace.label}</ItemTitle>
                      <ItemDescription>Notification settings</ItemDescription>
                    </ItemContent>
                  </Link>
                </Item>
              ))}
          </ItemGroup>
        </SettingsSection>
      ) : null}
      {section === "pet" && background ? (
        <SettingsSection title="Background activity">{background}</SettingsSection>
      ) : null}
      {!connectionOnly && section === "desktop" ? <DesktopUpdates /> : null}
    </div>
  );
}
