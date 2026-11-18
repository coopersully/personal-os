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
import { Copy, FinanceScreen, ReadState } from "./ui";

export type HostStatus = Awaited<
  ReturnType<ReturnType<typeof useFinance>["api"]["listAutomationHostSchedules"]>
>[number];
/** Runs one automation write under one toast. True only when the server confirmed it. */
export type AutomationAction = (
  action: () => Promise<unknown>,
  message: string,
) => Promise<boolean>;

/**
 * One automation write at a time, with one toast from loading to the confirmed outcome. The
 * registrations are read again after every attempt, so what the screens show is always what the
 * server lists and never what a request asked for.
 */
export function useAutomationWrite(): { pending: boolean; perform: AutomationAction } {
  const { owner } = useFinance();
  const client = useQueryClient();
  const current = useCurrentSession();
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const perform: AutomationAction = async (action, message) => {
    if (busy.current) return false;
    busy.current = true;
    setPending(true);
    const id = toast.loading("Saving automation…");
    let saved = false;
    try {
      await action();
      saved = true;
    } catch (error) {
      if (current())
        toast.error(
          error instanceof ApiClientError && error.status === 409
            ? "This automation changed elsewhere. Nothing was saved; its latest state is shown."
            : confirmedRejection(error)
              ? `Automation not saved.${rejectionReason(error)}`
              : // The write may have landed; it is not sent again. The list read below shows it.
                "Couldn’t confirm the automation was saved. Check its state before trying again.",
          { id },
        );
    }
    try {
      await client.invalidateQueries({ queryKey: ["finances", owner] });
      if (!current()) toast.dismiss(id);
      else if (saved) toast.success(message, { id });
      return saved && current();
    } finally {
      busy.current = false;
      if (current()) setPending(false);
    }
  };
  return { pending, perform };
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
            ).then((saved) => {
              if (saved) onClose();
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
  const { pending, perform } = useAutomationWrite();
  const connections = useFinanceRead(["automation-connections"], (api) =>
    api.listAutomationHostConnections(),
  );
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
          <Actions inset={false}>
            <Action
              label="Register expected schedule"
              disabled={pending || !input}
              onPress={() => {
                if (!input) return;
                void perform(
                  () => api.createAutomationHostSchedule(input),
                  "Automation registered. Set it up in your host.",
                ).then((saved) => {
                  if (saved) router.back();
                });
              }}
            />
          </Actions>
        </ReadState>
      </SettingsAccentProvider>
    </FinanceScreen>
  );
}
