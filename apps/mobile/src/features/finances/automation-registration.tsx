import { ApiClientError } from "@personal-os/api-client";
import type { AutomationHostScheduleCreateInput } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { toast } from "sonner-native";
import { EnumChoice } from "../../components/forms/enum-choice";
import { Action, Actions, Group } from "../../components/forms/form-rows";
import { SettingsAccentProvider } from "../../components/settings-accent";
import { DateField } from "../tasks/date-field";
import { TextRow } from "./account-editor";
import { useCurrentSession } from "./budget-write";
import { useFinance, useFinanceRead } from "./data";
import { confirmedRejection, rejectionReason } from "./mutations";
import { Card, Copy, FinanceRow, FinanceScreen, ReadState } from "./ui";

export type HostStatus = Awaited<
  ReturnType<ReturnType<typeof useFinance>["api"]["listAutomationHostSchedules"]>
>[number];
/**
 * How one automation write ended. `unknown` is an unconfirmed write whose registrations were
 * read again and do not show it; `unchecked` is one whose registrations could not be read.
 */
export type AutomationOutcome = "saved" | "not_saved" | "unknown" | "unchecked";
/**
 * Runs one automation write under one toast. `landed` recognises the write in a fresh read of
 * the registrations, so an unconfirmed write that did arrive is reported as saved.
 */
export type AutomationAction = (
  action: () => Promise<unknown>,
  message: string,
  landed?: (schedules: HostStatus[]) => boolean,
) => Promise<AutomationOutcome>;

const unconfirmed =
  "Couldn’t confirm the automation was saved. Check its state before trying again.";

/**
 * One automation write at a time, with one toast from loading to the confirmed outcome. A
 * confirmed write is announced as soon as the server answers. The registrations are read again
 * after every attempt, and no further write is accepted until they have been, so what the
 * screens show and send against is always what the server lists.
 */
export function useAutomationWrite(): {
  pending: boolean;
  perform: AutomationAction;
  /** Reads the registrations again, bypassing the cache. */
  readSchedules: () => Promise<HostStatus[]>;
} {
  const { api, owner } = useFinance();
  const client = useQueryClient();
  const current = useCurrentSession();
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const readSchedules = () =>
    client.fetchQuery({
      queryKey: ["finances", owner, "automation-schedules"],
      queryFn: () => api.listAutomationHostSchedules(),
      staleTime: 0,
    });
  const perform: AutomationAction = async (action, message, landed) => {
    if (busy.current) return "not_saved";
    busy.current = true;
    setPending(true);
    const id = toast.loading("Saving automation…");
    let outcome: AutomationOutcome = "not_saved";
    try {
      await action();
      outcome = "saved";
      if (current()) toast.success(message, { id });
    } catch (error) {
      const conflict = error instanceof ApiClientError && error.status === 409;
      // The write may have landed; it is not sent again. The read below looks for it.
      if (!conflict && !confirmedRejection(error)) outcome = landed ? "unchecked" : "unknown";
      if (current() && outcome === "not_saved")
        toast.error(
          conflict
            ? "This automation changed elsewhere. Nothing was saved; its latest state is shown."
            : `Automation not saved.${rejectionReason(error as Error)}`,
          { id },
        );
      else if (current() && !landed) toast.error(unconfirmed, { id });
    }
    // The refresh runs behind the announced outcome; this hook stays busy until it settles.
    const refresh = client
      .invalidateQueries({ queryKey: ["finances", owner] })
      .catch(() => undefined)
      .finally(() => {
        busy.current = false;
        if (current()) setPending(false);
      });
    if (outcome === "unchecked" && landed) {
      try {
        outcome = landed(await readSchedules()) ? "saved" : "unknown";
      } catch {
        // Still unchecked: the caller keeps the write closed until the list can be read.
      }
      if (current()) {
        if (outcome === "saved") toast.success(message, { id });
        else toast.error(unconfirmed, { id });
      }
      await refresh;
    }
    if (!current()) {
      toast.dismiss(id);
      return "not_saved";
    }
    return outcome;
  };
  return { pending, perform, readSchedules };
}

/** Records the identifier of the job the person created in their host. A one-time step. */
export function AutomationBinding({
  status,
  pending,
  perform,
  onClose,
}: {
  status: HostStatus;
  pending: boolean;
  perform: AutomationAction;
  onClose: () => void;
}) {
  const { api } = useFinance();
  const { schedule } = status;
  const [hostId, setHostId] = useState("");
  const [next, setNext] = useState<string | null>(null);
  const codex = schedule.hostSurface === "codex_desktop";
  const nextAt = next ? Date.parse(next) : Number.NaN;
  const ready = !!hostId.trim() && (!codex || Number.isFinite(nextAt));
  return (
    <>
      {schedule.trigger.type === "scheduled" && (
        <Copy secondary>
          {`Create the Claude schedule at ${schedule.trigger.localTimes.join(" and ")} in ${schedule.trigger.timeZone}, then enter its routine identifier. Starts may be several minutes late.`}
        </Copy>
      )}
      <Group>
        <TextRow
          label="Host automation ID"
          value={hostId}
          onChangeText={setHostId}
          editable={!pending}
          maxLength={240}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Required"
        />
        {codex && <DateField label="Next run" value={next} onChange={setNext} />}
      </Group>
      <Actions inset={false}>
        <Action label="Cancel" disabled={pending} onPress={onClose} />
        <Action
          label="Save host automation ID"
          disabled={pending || !ready || status.connectionAvailable === false}
          onPress={() =>
            void perform(
              () =>
                api.bindAutomationHostSchedule(schedule.id, {
                  expectedVersion: schedule.version,
                  expectedState: "setup_pending",
                  hostAutomationId: hostId.trim(),
                  ...(codex
                    ? {
                        hostSurface: "codex_desktop",
                        nextExpectedAt: new Date(nextAt).toISOString(),
                      }
                    : { hostSurface: "claude_code_routine" }),
                }),
              "Host automation ID saved.",
            ).then((outcome) => {
              if (outcome === "saved") onClose();
            })
          }
        />
      </Actions>
    </>
  );
}

const hosts = [
  { value: "codex_desktop", label: "Codex desktop · recurring interval" },
  { value: "claude_scheduled", label: "Claude routine · daily local times" },
  { value: "claude_event", label: "Claude routine · event trigger" },
] as const;
type Host = (typeof hosts)[number]["value"];
/** A host surface with a trigger that surface accepts. */
type DeclaredSchedule = AutomationHostScheduleCreateInput extends infer Input
  ? Input extends { hostSurface: unknown; trigger: unknown }
    ? Pick<Input, "hostSurface" | "trigger">
    : never
  : never;

/** Whole minutes from 1 to `max`; `null` for anything else. */
function wholeMinutes(text: string, max: number): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const minutes = Number(text);
  return minutes >= 1 && minutes <= max ? minutes : null;
}
/** One to eight distinct 24-hour times; `null` for anything else. */
function localTimes(text: string): string[] | null {
  const times = text
    .split(",")
    .map((time) => time.trim())
    .filter(Boolean);
  const valid =
    times.length >= 1 &&
    times.length <= 8 &&
    new Set(times).size === times.length &&
    times.every((time) => /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(time));
  return valid ? times : null;
}

/**
 * Declares the schedule a host is expected to keep. nohmi never creates, changes or runs the
 * host's job: a new registration waits in setup until the person binds the job they made.
 */
export function FinanceAutomationRegistrationScreen() {
  const { api, timezone } = useFinance();
  const { pending, perform, readSchedules } = useAutomationWrite();
  const current = useCurrentSession();
  const connections = useFinanceRead(["automation-connections"], (api) =>
    api.listAutomationHostConnections(),
  );
  // The registrations that exist now: a new one can only be recognised against them.
  const schedules = useFinanceRead(["automation-schedules"], (api) =>
    api.listAutomationHostSchedules(),
  );
  /**
   * After an unconfirmed registration whose list could not be read: recognises that registration
   * in a later read. Registering stays closed while this is set.
   */
  const [unchecked, setUnchecked] = useState<{
    landed: (list: HostStatus[]) => boolean;
  } | null>(null);
  const [checking, setChecking] = useState(false);
  const checkLock = useRef(false);
  const [label, setLabel] = useState("Finance maintenance");
  const [connection, setConnection] = useState<string | null>(null);
  const [host, setHost] = useState<Host>("codex_desktop");
  const [times, setTimes] = useState("08:00, 20:00");
  const [minutes, setMinutes] = useState("1440");
  const [zone, setZone] = useState(
    () => timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const eligible =
    connections.data?.filter((item) => item.scopes.includes("finances:maintain")) ?? [];
  const chosen = eligible.find((item) => item.id === connection);

  const timeZone = zone.trim();
  const everyMinutes = wholeMinutes(minutes, host === "codex_desktop" ? 10_080 : 60);
  const daily = localTimes(times);
  const schedule: DeclaredSchedule | null =
    host === "claude_event"
      ? everyMinutes === null
        ? null
        : {
            hostSurface: "claude_code_routine",
            trigger: { type: "event", expectedMaximumLatencyMinutes: everyMinutes },
          }
      : !timeZone
        ? null
        : host === "claude_scheduled"
          ? daily && {
              hostSurface: "claude_code_routine",
              trigger: { type: "scheduled", localTimes: daily, timeZone },
            }
          : everyMinutes === null
            ? null
            : {
                hostSurface: "codex_desktop",
                trigger: {
                  type: "recurring",
                  recurrence: { type: "interval", everyMinutes, timeZone },
                },
              };
  const input: AutomationHostScheduleCreateInput | null =
    chosen && label.trim() && schedule
      ? {
          label: label.trim(),
          tenantAuthorizationConnectionId: chosen.id,
          requestedScopes: ["finances:maintain"],
          ...schedule,
        }
      : null;

  const registered = "Automation registered. Set it up in your host.";
  function register() {
    if (!input || !schedules.data) return;
    const known = new Set(schedules.data.map((item) => item.schedule.id));
    // A registration this form did not see before, declaring what this form asked for.
    const landed = (list: HostStatus[]) =>
      list.some(
        ({ schedule }) =>
          !known.has(schedule.id) &&
          schedule.label === input.label &&
          schedule.tenantAuthorizationConnectionId === input.tenantAuthorizationConnectionId &&
          schedule.hostSurface === input.hostSurface &&
          schedule.trigger.type === input.trigger.type,
      );
    void perform(() => api.createAutomationHostSchedule(input), registered, landed).then(
      (outcome) => {
        if (outcome === "saved") router.back();
        else if (outcome === "unchecked") setUnchecked({ landed });
      },
    );
  }
  /** Reads the registrations again after an unconfirmed registration, under its own toast. */
  async function check() {
    if (!unchecked || checkLock.current) return;
    checkLock.current = true;
    setChecking(true);
    const id = toast.loading("Checking automations…");
    try {
      const found = unchecked.landed(await readSchedules());
      if (!current()) return void toast.dismiss(id);
      setUnchecked(null);
      if (found) {
        toast.success(registered, { id });
        router.back();
      } else toast.info("That registration isn’t listed. You can register it again.", { id });
    } catch {
      if (!current()) return void toast.dismiss(id);
      toast.error("Couldn’t read your automations. Check again before registering.", { id });
    } finally {
      checkLock.current = false;
      if (current()) setChecking(false);
    }
  }

  return (
    <FinanceScreen title="Register automation">
      <SettingsAccentProvider workspace="finances">
        <Copy secondary>
          Register the schedule you expect here, then create the job in your host. nohmi does not
          create, change or run the host’s job.
        </Copy>
        <ReadState query={connections}>
          {!eligible.length && (
            <Copy>Connect a host with Finance maintenance permission before registering.</Copy>
          )}
          <Group>
            <TextRow
              label="Name"
              value={label}
              onChangeText={setLabel}
              editable={!pending}
              maxLength={100}
              placeholder="Required"
            />
            <EnumChoice
              label="Authorized connection"
              icon="agent"
              value={chosen?.id ?? null}
              valueLabel={chosen ? undefined : "Choose a connection"}
              disabled={pending || !eligible.length}
              options={eligible.map((item) => ({
                value: item.id,
                label: item.agentAccount
                  ? `${item.agentAccount.displayName} · ${item.label}`
                  : item.label,
              }))}
              onChange={setConnection}
            />
            <EnumChoice
              label="Host"
              icon="settings"
              value={host}
              disabled={pending}
              options={hosts}
              onChange={(next) => {
                setHost(next as Host);
                setMinutes(next === "codex_desktop" ? "1440" : "5");
              }}
            />
            {host === "claude_scheduled" ? (
              <TextRow
                label="Daily local times"
                value={times}
                onChangeText={setTimes}
                editable={!pending}
                autoCorrect={false}
                correction={
                  daily ? undefined : "Use 24-hour times separated by commas, such as 08:00, 20:00"
                }
              />
            ) : (
              <TextRow
                label={
                  host === "codex_desktop"
                    ? "Interval in minutes"
                    : "Maximum event latency in minutes"
                }
                value={minutes}
                onChangeText={setMinutes}
                editable={!pending}
                keyboardType="number-pad"
                correction={
                  everyMinutes === null
                    ? `Enter whole minutes from 1 to ${host === "codex_desktop" ? "10080" : "60"}`
                    : undefined
                }
              />
            )}
            {host !== "claude_event" && (
              <TextRow
                label="Time zone"
                value={zone}
                onChangeText={setZone}
                editable={!pending}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Required"
              />
            )}
          </Group>
          {unchecked && !pending && (
            <Card rows>
              <FinanceRow
                title="Check automations"
                subtitle="Read your automations before registering again."
                icon="refresh"
                onPress={checking ? undefined : () => void check()}
              />
            </Card>
          )}
          {/* Without the current registrations a repeated request could not be recognised. */}
          <ReadState query={schedules}>
            <Actions inset={false}>
              <Action
                label="Register expected schedule"
                disabled={pending || checking || !input || !!unchecked}
                onPress={register}
              />
            </Actions>
          </ReadState>
        </ReadState>
      </SettingsAccentProvider>
    </FinanceScreen>
  );
}
