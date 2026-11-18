import { router } from "expo-router";
import { useState } from "react";
import { Action, Actions, Group } from "../../components/forms/form-rows";
import { SettingsAccentProvider } from "../../components/settings-accent";
import { TextRow } from "./account-editor";
import {
  type AutomationAction,
  AutomationBinding,
  type HostStatus,
  useAutomationWrite,
} from "./automation-registration";
import { useFinance, useFinanceRead } from "./data";
import { confirmChoice } from "./goal-confirm";
import { Card, Copy, FinanceRow, FinanceScreen, ReadState, Section } from "./ui";

const stateLabels: Record<HostStatus["schedule"]["state"], string> = {
  setup_pending: "Setup pending",
  active: "Active",
  paused: "Paused",
  cancelled: "Cancelled",
  revoked: "Revoked",
};

/** A time the host or its declared cadence gave, in the schedule's own zone when it has one. */
function when(value: string | null, timeZone?: string) {
  if (!value) return "Not reported";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone ? { timeZone, timeZoneName: "short" } : {}),
  });
}
function scheduleZone(trigger: HostStatus["schedule"]["trigger"]) {
  return trigger.type === "recurring"
    ? trigger.recurrence.timeZone
    : trigger.type === "scheduled"
      ? trigger.timeZone
      : undefined;
}
function cadence({ hostSurface, trigger }: HostStatus["schedule"]) {
  const host = hostSurface === "codex_desktop" ? "Codex desktop" : "Claude routine";
  return `${host} · ${
    trigger.type === "recurring"
      ? `Every ${trigger.recurrence.everyMinutes} minutes · ${trigger.recurrence.timeZone}`
      : trigger.type === "scheduled"
        ? `Daily at ${trigger.localTimes.join(" and ")} · ${trigger.timeZone}`
        : "Event-based · next run unknown"
  }`;
}
/** What the person can do about the state the server reports; the host itself is theirs to fix. */
function cause({ schedule, health, connectionAvailable }: HostStatus) {
  if (connectionAvailable === false) return "The original host connection is unavailable.";
  if (health.state === "overdue")
    return "This host missed its expected check-in. Check that the external job is enabled and connected.";
  if (health.state === "paused")
    return "This registration is paused. Resume the external job in the host.";
  if (health.state === "unknown")
    return "The host has not reported its next expected check-in. Check its schedule in the host.";
  if (schedule.state === "setup_pending")
    return "Finish setup in the external host, then enter its identifier here.";
  if (schedule.state === "cancelled" || schedule.state === "revoked")
    return "This registration no longer accepts runs.";
  return null;
}

function Automation({
  status,
  pending,
  perform,
}: {
  status: HostStatus;
  pending: boolean;
  perform: AutomationAction;
}) {
  const { api } = useFinance();
  const { schedule, health } = status;
  /** The name being typed; `null` while the name is not being edited. */
  const [name, setName] = useState<string | null>(null);
  const [binding, setBinding] = useState(false);
  const live = schedule.state === "active" || schedule.state === "paused";
  const waiting = schedule.state === "setup_pending";
  const timeZone = scheduleZone(schedule.trigger);
  const reason = cause(status);
  const label = name?.trim() ?? "";

  function stop() {
    confirmChoice({
      title: live ? "Remove this registration?" : "Cancel this setup?",
      message: live
        ? "Future dispatch and acceptance under this registration will stop. History stays available. Remove the external job in its host separately."
        : "This registration will stop waiting for a host job. History stays available.",
      cancel: live ? "Keep registration" : "Keep setup",
      accept: live ? "Remove registration" : "Cancel setup",
      destructive: live,
      onAccept: () =>
        void perform(
          () =>
            schedule.state === "setup_pending"
              ? api.cancelAutomationHostSchedule(schedule.id, {
                  expectedVersion: schedule.version,
                  expectedState: "setup_pending",
                })
              : api.revokeAutomationHostSchedule(schedule.id, {
                  expectedVersion: schedule.version,
                  expectedState: schedule.state as "active" | "paused",
                }),
          live ? "Registration removed. Stop the external job in its host." : "Setup cancelled.",
        ),
    });
  }

  return (
    <Section title={schedule.label}>
      <Card rows>
        <FinanceRow title="State" value={stateLabels[schedule.state]} icon="info" />
        <FinanceRow
          // A start worked out from a declared daily cadence is a projection, not a host report.
          title={
            schedule.trigger.type === "scheduled" ? "Projected next start" : "Next expected start"
          }
          value={when(health.nextExpectedAt, timeZone)}
          icon="calendar"
        />
        <FinanceRow
          title="Last observed"
          value={when(health.lastObservedAt, timeZone)}
          icon="history"
        />
        {health.state === "overdue" && (
          <FinanceRow title="Check-in" value="Overdue" valueTone="attention" icon="attention" />
        )}
      </Card>
      <Copy secondary>{cadence(schedule)}</Copy>
      {reason && <Copy secondary>{reason}</Copy>}
      {name !== null && (
        <>
          <Group>
            <TextRow
              label="Name"
              value={name}
              onChangeText={setName}
              editable={!pending}
              maxLength={100}
              placeholder="Required"
            />
          </Group>
          <Actions inset={false}>
            <Action label="Cancel" disabled={pending} onPress={() => setName(null)} />
            <Action
              label="Save name"
              disabled={pending || !label || label === schedule.label}
              onPress={() =>
                void perform(
                  () =>
                    api.updateAutomationHostSchedule(schedule.id, {
                      expectedVersion: schedule.version,
                      label,
                    }),
                  "Automation name saved.",
                ).then((outcome) => {
                  if (outcome === "saved") setName(null);
                })
              }
            />
          </Actions>
        </>
      )}
      {binding && waiting && (
        <AutomationBinding
          status={status}
          pending={pending}
          perform={perform}
          onClose={() => setBinding(false)}
        />
      )}
      {(live || waiting) && (
        <Actions inset={false}>
          {name === null && (
            <Action
              label="Rename"
              accessibilityLabel={`Rename ${schedule.label}`}
              disabled={pending}
              onPress={() => setName(schedule.label)}
            />
          )}
          {waiting && !binding && (
            <Action
              label="Enter host automation ID"
              accessibilityLabel={`Enter host automation ID for ${schedule.label}`}
              disabled={pending}
              onPress={() => setBinding(true)}
            />
          )}
          <Action
            label={live ? "Remove registration" : "Cancel setup"}
            accessibilityLabel={`${live ? "Remove registration" : "Cancel setup"} of ${schedule.label}`}
            destructive={live}
            disabled={pending}
            onPress={stop}
          />
        </Actions>
      )}
    </Section>
  );
}

/**
 * The hosts registered to run Finance maintenance. The host owns its schedule; this screen shows
 * what nohmi expects and has observed, and changes only nohmi's own record of the registration.
 */
export function FinanceAutomationsScreen() {
  const schedules = useFinanceRead(["automation-schedules"], (api) =>
    api.listAutomationHostSchedules(),
  );
  const { pending, perform } = useAutomationWrite();
  return (
    <FinanceScreen title="Automations">
      <SettingsAccentProvider workspace="finances">
        <Copy secondary>
          Your host runs on its own schedule. nohmi records what to expect; create, change or stop
          the job in the host itself.
        </Copy>
        <Copy secondary>Fire tokens, host prompts and run recovery are managed on the web.</Copy>
        <Card rows>
          <FinanceRow
            title="Register automation"
            subtitle="Declare the schedule a host is expected to keep"
            icon="add"
            onPress={() => router.push("/finance-automation-new")}
          />
        </Card>
        <ReadState query={schedules}>
          {schedules.data?.length === 0 && (
            <Copy secondary>No Finance automations registered.</Copy>
          )}
          {schedules.data?.map((status) => (
            <Automation
              key={status.schedule.id}
              status={status}
              pending={pending}
              perform={perform}
            />
          ))}
        </ReadState>
      </SettingsAccentProvider>
    </FinanceScreen>
  );
}
