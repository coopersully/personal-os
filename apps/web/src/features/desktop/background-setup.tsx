import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { api } from "../../api.js";
import { MonitorIcon } from "../../components/icons.js";
import { MutationFeedback } from "../../components/mutation-feedback.js";
import { ReadinessPanel, type ReadinessPanelCheck } from "../../components/readiness-panel.js";
import { Button } from "../../components/ui/button.js";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../components/ui/collapsible.js";
import { ItemGroup } from "../../components/ui/item.js";
import { useSettingsError } from "../../lib/settings-feedback.js";
import { useFeedbackMutation } from "../../lib/use-feedback-mutation.js";
import {
  type DesktopStatus,
  getDesktopSettings,
  nativeAction,
  saveDesktopSettings,
} from "./bridge.js";

export function BackgroundSetup({
  status,
  stale,
  saving,
  dirty,
  section,
  onStartupEnabled,
}: {
  status: DesktopStatus;
  stale: boolean;
  saving: boolean;
  dirty: boolean;
  section: string;
  onStartupEnabled: () => void;
}) {
  const cache = useQueryClient();
  const local = useQuery({
    queryKey: ["ritual-local"],
    queryFn: () =>
      invoke<{
        enabled: boolean;
        recovery?: boolean;
        storageWarning?: boolean;
        deliveryHealth?: unknown;
      }>("ritual_local", { discard: false }),
    refetchInterval: 10000,
  });
  const rituals = useQuery({ queryKey: ["rituals"], queryFn: api.listRituals });
  useSettingsError(local.error, "Couldn’t check local routine status.");
  useSettingsError(rituals.error, "Couldn’t load routines.");
  const startup = useFeedbackMutation({
    mutationKey: ["desktop-startup"],
    scope: { id: "desktop-preferences" },
    feedback: { action: "enable launch at login", safeToRetry: true, form: false },
    mutationFn: async () => {
      const current = await getDesktopSettings();
      const value = await saveDesktopSettings({ ...current.settings, launchAtLogin: true });
      cache.setQueryData(["desktop-settings"], value);
      onStartupEnabled();
      if (
        value.native.error &&
        !["enabled", "requiresApproval"].includes(value.native.loginStatus ?? "")
      )
        throw new Error("macOS could not register launch at login.");
      return value;
    },
    onSuccess: (value) => {
      cache.setQueryData(["desktop-settings"], value);
    },
  });
  const action = useFeedbackMutation({
    feedback: { action: "open macOS settings", safeToRetry: true, form: false },
    mutationFn: nativeAction,
    onSuccess: () => cache.invalidateQueries({ queryKey: ["desktop-settings"] }),
  });
  const link = (target: string, label: string) =>
    target === section ? undefined : dirty || saving ? (
      <Button type="button" disabled size="sm" variant="outline">
        {label} — saving preferences
      </Button>
    ) : (
      <Button asChild size="sm" variant="outline">
        <a href={`/settings?section=${target}`}>{label}</a>
      </Button>
    );
  const login = status.native.loginStatus;
  const loginEnabled = login === "enabled" && status.native.launchAtLogin === true;
  const startupDescription = loginEnabled
    ? "nohmi starts in the menu bar when you sign in to your Mac."
    : login === "requiresApproval"
      ? "Approve nohmi in System Settings → General → Login Items. Then return here to check its status."
      : login === "notFound"
        ? "macOS could not find the login item. Install nohmi in Applications, open it there, and try again."
        : login === "notRegistered"
          ? "Enable launch at login so the pet and routines can resume after you restart and sign in."
          : "Could not confirm launch at login on this device.";
  const permission = status.native.notificationPermission;
  const morning = rituals.data?.rituals.find((ritual) => ritual.kind === "morning");
  const checks: ReadinessPanelCheck[] = [
    {
      id: "startup",
      title: "Launch at login",
      complete: !stale && loginEnabled,
      description: startupDescription,
      action:
        login === "requiresApproval" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={action.isPending}
            onClick={() => action.mutate("open_login_settings")}
          >
            Open Login Items
          </Button>
        ) : !loginEnabled ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={startup.isPending || saving || !login}
            onClick={() => startup.mutate()}
          >
            Enable launch at login
          </Button>
        ) : undefined,
    },
    {
      id: "notifications",
      title: "Desktop notifications",
      complete:
        !stale &&
        status.settings.notifications.enabled &&
        permission === "authorized" &&
        status.native.notificationAlertsAvailable === true,
      description: !status.settings.notifications.enabled
        ? "Notifications are turned off in nohmi. Choose which alerts you want to receive."
        : permission === "denied"
          ? "Allow nohmi notifications in macOS System Settings."
          : permission === "authorized" && status.native.notificationAlertsAvailable === false
            ? "Notifications are allowed, but macOS alerts are off. Enable banners or alerts in System Settings."
            : permission === "authorized" && status.native.notificationAlertsAvailable === true
              ? "macOS allows alerts. Focus and quiet hours can still silence them; send a test in Notifications."
              : "Open Notifications to check macOS permission and send a test alert.",
      action: link("notifications", "Set up notifications"),
    },
    {
      id: "pet",
      title: "Desktop pet",
      complete: !stale && status.settings.petEnabled,
      description: status.settings.petEnabled
        ? "The pet is enabled and stays available when you close the main window."
        : "Turn on the pet to keep quick access on your desktop.",
      action: link("pet", "Pet settings"),
    },
    {
      id: "morning",
      title: "Morning routine",
      complete: Boolean(
        !local.isError &&
          !rituals.isError &&
          morning?.enabled &&
          local.data?.enabled &&
          !local.data.recovery &&
          !local.data.storageWarning &&
          !local.data.deliveryHealth,
      ),
      description:
        local.isPending || rituals.isPending
          ? "Checking the morning schedule and automatic delivery on this Mac…"
          : local.isError || rituals.isError
            ? "Could not check morning routine readiness. Open Rituals to retry."
            : local.data?.recovery || local.data?.storageWarning || local.data?.deliveryHealth
              ? "Routine delivery needs attention. Open Rituals to review recovery and sync status."
              : !morning?.enabled
                ? "Choose a morning schedule and enable it in Rituals."
                : !local.data?.enabled
                  ? "Your morning schedule is enabled. Enable automatic rituals on this Mac in Rituals."
                  : `Scheduled for ${morning.time} (${morning.timeZone}), with automatic rituals enabled on this Mac.`,
      action: link("rituals", "Routine settings"),
    },
  ];
  const next = checks.find((check) => !check.complete);
  return (
    <div className="flex flex-col gap-3">
      <ItemGroup>
        <ReadinessPanel
          title="Keep nohmi active"
          icon={<MonitorIcon aria-hidden="true" />}
          description="Check startup, notifications, your pet, and morning routine."
          detailsLabel="Background setup"
          checks={checks}
          loading={local.isPending || rituals.isPending}
          unavailable={
            stale ||
            local.isError ||
            rituals.isError ||
            !["enabled", "requiresApproval", "notRegistered", "notFound"].includes(login ?? "") ||
            Boolean(status.native.error)
          }
          {...(next ? { focus: { label: "Next step" as const, title: next.title } } : {})}
        />
      </ItemGroup>
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button type="button" size="sm" variant="ghost">
            Background behavior
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-2 pt-2 text-sm text-muted-foreground">
          <p>
            Closing the window keeps enabled features running in the menu bar. Quitting nohmi stops
            the pet, routines, and new notification checks.
          </p>
          <p>
            Routines resume when your Mac wakes. Alerts already scheduled with macOS may still
            arrive after quitting.
          </p>
        </CollapsibleContent>
      </Collapsible>
      <MutationFeedback feedback={startup.feedback} />
      <MutationFeedback feedback={action.feedback} />
    </div>
  );
}
