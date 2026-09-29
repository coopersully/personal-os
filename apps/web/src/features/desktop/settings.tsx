import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "../../api.js";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert.js";
import { Button } from "../../components/ui/button.js";
import { Checkbox } from "../../components/ui/checkbox.js";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "../../components/ui/field.js";
import { Input } from "../../components/ui/input.js";
import { Switch } from "../../components/ui/switch.js";
import {
  type DesktopSettings,
  getDesktopSettings,
  hostedServer,
  isDesktop,
  nativeAction,
  resetDesktopConnection,
  saveDesktopSettings,
  testDesktopServer,
} from "./bridge.js";
import { resetDesktopSession } from "./session.js";

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
export function DesktopSettingsPanel({
  section = "desktop",
  connectionOnly = false,
}: {
  section?: "desktop" | "pet" | "notifications";
  connectionOnly?: boolean;
}) {
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: ["desktop-settings"],
    queryFn: getDesktopSettings,
    refetchOnMount: "always",
    enabled: isDesktop(),
  });
  const [draft, setDraft] = useState<DesktopSettings | null>(null);
  const [tested, setTested] = useState<string | null>(null);
  useEffect(() => {
    if (query.data && query.isFetchedAfterMount)
      setDraft((current) => current ?? query.data.settings);
  }, [query.data, query.isFetchedAfterMount]);
  const save = useMutation({
    mutationFn: saveDesktopSettings,
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
  const test = useMutation({
    mutationFn: testDesktopServer,
    onSuccess: (_, server) => setTested(server),
  });
  const action = useMutation({
    mutationFn: nativeAction,
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ["desktop-settings"] });
    },
  });
  const accounts = useQuery({
    queryKey: ["connectors", "notification-settings"],
    queryFn: api.listConnectors,
    enabled: isDesktop() && section === "notifications" && !connectionOnly,
  });
  const mailboxes = useQuery({
    queryKey: ["mailboxes", "notification-settings"],
    queryFn: api.listMailboxes,
    enabled: isDesktop() && section === "notifications" && !connectionOnly,
  });
  const calendars = useQuery({
    queryKey: ["calendars", "notification-settings"],
    queryFn: api.listCalendars,
    enabled: isDesktop() && section === "notifications" && !connectionOnly,
  });
  if (!isDesktop()) return null;
  if (query.isPending) return <p role="status">Loading desktop preferences…</p>;
  if (query.error)
    return (
      <Alert variant="destructive">
        <AlertTitle>Desktop preferences unavailable</AlertTitle>
        <AlertDescription>
          {errorMessage(query.error)}
          <Button variant="outline" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  if (!draft) return null;
  const update = (value: Partial<DesktopSettings>) => setDraft({ ...draft, ...value });
  const notification = (value: Partial<DesktopSettings["notifications"]>) =>
    update({ notifications: { ...draft.notifications, ...value } });
  const failure = save.error ?? test.error ?? action.error;
  return (
    <section
      className="flex flex-col gap-5"
      aria-label={
        connectionOnly
          ? "Desktop server"
          : section === "pet"
            ? "Desktop pet"
            : section === "notifications"
              ? "Notifications"
              : "Desktop"
      }
    >
      <h2>
        {connectionOnly
          ? "Server"
          : section === "pet"
            ? "Desktop pet"
            : section === "notifications"
              ? "Notifications"
              : "Desktop"}
      </h2>
      {query.data?.native.error ? (
        <Alert variant="destructive">
          <AlertTitle>macOS needs attention</AlertTitle>
          <AlertDescription>{query.data.native.error}</AlertDescription>
        </Alert>
      ) : null}
      {failure ? (
        <Alert variant="destructive">
          <AlertTitle>Could not update desktop preferences</AlertTitle>
          <AlertDescription>
            {typeof failure === "string" ? failure : errorMessage(failure)}
          </AlertDescription>
        </Alert>
      ) : null}
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate(draft);
        }}
      >
        {section === "desktop" ? (
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="desktop-server">API server</FieldLabel>
              <Input
                id="desktop-server"
                value={draft.serverUrl}
                onChange={(event) => {
                  update({ serverUrl: event.target.value });
                  setTested(null);
                }}
                type="url"
                required
              />
              <FieldDescription>
                Use Hosted nohmi or the HTTPS address of your own nohmi API. Switching servers signs
                you out.
              </FieldDescription>
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  update({ serverUrl: hostedServer });
                  setTested(null);
                }}
              >
                Use Hosted nohmi
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={test.isPending}
                onClick={() => test.mutate(draft.serverUrl)}
              >
                {test.isPending ? "Testing…" : "Test connection"}
              </Button>
            </div>
            {tested === draft.serverUrl ? <p role="status">Connection verified</p> : null}
            {!connectionOnly ? (
              <>
                <Toggle
                  label="Open at login"
                  value={draft.launchAtLogin}
                  onChange={(launchAtLogin) => update({ launchAtLogin })}
                />
                {query.data?.wallpaperError ? (
                  <p role="alert">
                    Wallpaper: {query.data.wallpaperError}. nohmi will retry while it is running.
                  </p>
                ) : null}
                <FieldDescription>
                  Closing the window keeps nohmi in the menu bar. Use Quit nohmi to exit.
                </FieldDescription>
                {query.data?.native.loginStatus ? (
                  <p role="status">Login item: {query.data.native.loginStatus}</p>
                ) : null}
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
              </>
            ) : null}
          </FieldGroup>
        ) : null}
        {section === "pet" ? (
          <FieldGroup>
            <Toggle
              label="Show desktop pet"
              value={draft.petEnabled}
              onChange={(petEnabled) => update({ petEnabled })}
            />
            <Field>
              <FieldLabel htmlFor="pet-color">Pet color</FieldLabel>
              <Input
                id="pet-color"
                type="color"
                value={draft.petColor}
                onChange={(event) => update({ petColor: event.target.value })}
              />
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
              onClick={() => action.mutate("reset_pet_position")}
            >
              Reset pet position
            </Button>
            <FieldDescription>
              Animation follows your macOS Reduce Motion preference.
            </FieldDescription>
          </FieldGroup>
        ) : null}
        {section === "notifications" ? (
          <FieldGroup>
            <p role="status">
              macOS permission: {query.data?.native.notificationPermission ?? "unavailable"}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => action.mutate("request_notification_permission")}
              >
                Allow notifications
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
                onClick={() => action.mutate("test_notification")}
              >
                Test notification
              </Button>
            </div>
            <Toggle
              label="Enable notifications"
              value={draft.notifications.enabled}
              onChange={(enabled) => notification({ enabled })}
            />
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
                onChange={(event) => notification({ advanceMinutes: Number(event.target.value) })}
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
                          : draft.notifications.calendarIds.filter((id) => id !== calendar.id),
                      })
                    }
                  />
                  <FieldLabel htmlFor={`notify-calendar-${calendar.id}`}>
                    {calendar.name}
                  </FieldLabel>
                </Field>
              ))}
            </FieldSet>
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
                            : draft.notifications.mailAccountIds.filter((id) => id !== accountId),
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
              {mailboxes.error ? <p role="alert">Mail accounts could not be loaded.</p> : null}
              {query.data?.mailError ? (
                <p role="alert">
                  Mail notifications could not refresh: {query.data.mailError}. nohmi will retry
                  while running.
                </p>
              ) : null}
              {accounts.data
                ?.filter((account) => account.syncError)
                .map((account) => (
                  <p role="status" key={account.id}>
                    {account.email}: {account.syncError}. Check Connections to reconnect.
                  </p>
                ))}
            </FieldSet>
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
            </FieldSet>
            <FieldDescription>
              Notifications work with the window closed and the pet disabled. macOS Focus and
              notification settings control presentation.
            </FieldDescription>
          </FieldGroup>
        ) : null}
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save preferences"}
        </Button>
      </form>
    </section>
  );
}
