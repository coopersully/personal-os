import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { AgentIdentity } from "@/components/agent-identity";
import {
  ResponsiveDialog as Dialog,
  ResponsiveDialogContent as DialogContent,
  ResponsiveDialogDescription as DialogDescription,
  ResponsiveDialogHeader as DialogHeader,
  ResponsiveDialogTitle as DialogTitle,
  ResponsiveDialogTrigger as DialogTrigger,
  ResponsiveDialogBody,
} from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { api } from "../../api.js";
import { QueryFeedback } from "../../components/async-state.js";

import { sameSession, usePreferenceSession } from "../workspace-settings/account-save-session";

export type AutomationAction = (
  action: () => Promise<unknown>,
  message: string,
) => Promise<boolean>;
export type HostStatus = Awaited<ReturnType<typeof api.listAutomationHostSchedules>>[number];

export function AutomationRegistration({
  pending,
  perform,
}: {
  pending: boolean;
  perform: AutomationAction;
}) {
  const cache = useQueryClient();
  const session = usePreferenceSession(cache);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("Finance maintenance");
  const [connection, setConnection] = useState("");
  const [host, setHost] = useState("codex_desktop");
  const [minutes, setMinutes] = useState("1440");
  const [zone, setZone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const connections = useQuery({
    queryKey: ["finance-host-connections", session.owner, session.epoch],
    enabled: !!session.owner,
    queryFn: async () => {
      const result = await api.listAutomationHostConnections();
      if (!sameSession(cache, session)) throw new Error("Your account session changed.");
      return result;
    },
  });
  const eligible =
    connections.data?.filter((item) => item.scopes.includes("finances:maintain")) ?? [];
  const selectedAccount = eligible.find((item) => item.id === connection)?.agentAccount;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Register automation</Button>
      </DialogTrigger>
      <DialogContent data-finance-dialog data-finance-size="default">
        <DialogHeader>
          <DialogTitle>Register Finance automation</DialogTitle>
          <DialogDescription>
            Register the expected schedule here, then create the job in your host. Your existing
            connection must already authorize Finance maintenance.
          </DialogDescription>
        </DialogHeader>
        <ResponsiveDialogBody>
          <QueryFeedback query={connections} title="Host connections could not be loaded" />
          {connections.isSuccess && !eligible.length ? (
            <p>Connect a host with Finance maintenance permission before registering.</p>
          ) : null}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void perform(
                () =>
                  api.createAutomationHostSchedule({
                    label,
                    tenantAuthorizationConnectionId: connection,
                    requestedScopes: ["finances:maintain"],
                    ...(host === "codex_desktop"
                      ? {
                          hostSurface: "codex_desktop",
                          trigger: {
                            type: "recurring",
                            recurrence: {
                              type: "interval",
                              everyMinutes: Number(minutes),
                              timeZone: zone,
                            },
                          },
                        }
                      : {
                          hostSurface: "claude_code_routine",
                          trigger: {
                            type: "event",
                            expectedMaximumLatencyMinutes: Number(minutes),
                          },
                        }),
                  }),
                "Automation registered. Set it up in your host.",
              ).then((saved) => {
                if (saved) setOpen(false);
              });
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
                <Input
                  id={`${id}-name`}
                  required
                  maxLength={100}
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-connection`}>Authorized connection</FieldLabel>
                <NativeSelect
                  id={`${id}-connection`}
                  required
                  value={connection}
                  onChange={(event) => setConnection(event.target.value)}
                >
                  <NativeSelectOption value="">Choose a connection</NativeSelectOption>
                  {eligible.map((item) => (
                    <NativeSelectOption key={item.id} value={item.id}>
                      {item.agentAccount
                        ? `${item.agentAccount.displayName} · ${item.label}`
                        : item.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                {selectedAccount ? <AgentIdentity account={selectedAccount} /> : null}
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-host`}>Host</FieldLabel>
                <NativeSelect
                  id={`${id}-host`}
                  value={host}
                  onChange={(event) => {
                    setHost(event.target.value);
                    setMinutes(event.target.value === "codex_desktop" ? "1440" : "5");
                  }}
                >
                  <NativeSelectOption value="codex_desktop">
                    Codex desktop · recurring interval
                  </NativeSelectOption>
                  <NativeSelectOption value="claude_code_routine">
                    Claude routine · event trigger
                  </NativeSelectOption>
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-minutes`}>
                  {host === "codex_desktop"
                    ? "Interval in minutes"
                    : "Maximum event latency in minutes"}
                </FieldLabel>
                <Input
                  id={`${id}-minutes`}
                  type="number"
                  min={1}
                  max={host === "codex_desktop" ? 10080 : 60}
                  required
                  value={minutes}
                  onChange={(event) => setMinutes(event.target.value)}
                />
              </Field>
              {host === "codex_desktop" ? (
                <Field>
                  <FieldLabel htmlFor={`${id}-zone`}>Timezone</FieldLabel>
                  <Input
                    id={`${id}-zone`}
                    required
                    value={zone}
                    onChange={(event) => setZone(event.target.value)}
                  />
                </Field>
              ) : null}
              <Button
                type="submit"
                disabled={pending || !eligible.some((item) => item.id === connection)}
              >
                Register expected schedule
              </Button>
            </FieldGroup>
          </form>
        </ResponsiveDialogBody>
      </DialogContent>
    </Dialog>
  );
}

export function AutomationBinding({
  status,
  pending,
  perform,
}: {
  status: HostStatus;
  pending: boolean;
  perform: AutomationAction;
}) {
  const { schedule } = status;
  const [hostId, setHostId] = useState("");
  const [next, setNext] = useState("");
  const [token, setToken] = useState("");
  if (schedule.state === "active" && schedule.hostSurface === "claude_code_routine")
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void perform(
            () =>
              api.saveAutomationHostFireToken(schedule.id, {
                token,
                expectedVersion: schedule.version,
              }),
            "Trigger token saved.",
          ).then((saved) => {
            if (saved) setToken("");
          });
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`token-${schedule.id}`}>Routine API trigger token</FieldLabel>
            <Input
              id={`token-${schedule.id}`}
              type="password"
              autoComplete="off"
              required
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          </Field>
          <Button disabled={pending || status.connectionAvailable === false}>
            Save trigger token
          </Button>
        </FieldGroup>
      </form>
    );
  if (schedule.state !== "setup_pending") return null;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void perform(
          () =>
            api.bindAutomationHostSchedule(
              schedule.id,
              schedule.hostSurface === "codex_desktop"
                ? {
                    hostSurface: "codex_desktop",
                    expectedVersion: schedule.version,
                    expectedState: "setup_pending",
                    hostAutomationId: hostId,
                    nextExpectedAt: new Date(next).toISOString(),
                  }
                : {
                    hostSurface: "claude_code_routine",
                    expectedVersion: schedule.version,
                    expectedState: "setup_pending",
                    hostAutomationId: hostId,
                  },
            ),
          "Host binding saved.",
        );
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`binding-${schedule.id}`}>Host automation identifier</FieldLabel>
          <Input
            id={`binding-${schedule.id}`}
            required
            maxLength={240}
            value={hostId}
            onChange={(event) => setHostId(event.target.value)}
          />
        </Field>
        {schedule.hostSurface === "codex_desktop" ? (
          <Field>
            <FieldLabel htmlFor={`next-${schedule.id}`}>Next run in your local time</FieldLabel>
            <Input
              id={`next-${schedule.id}`}
              type="datetime-local"
              required
              value={next}
              onChange={(event) => setNext(event.target.value)}
            />
          </Field>
        ) : null}
        <Button disabled={pending || status.connectionAvailable === false}>
          Bind existing host job
        </Button>
      </FieldGroup>
    </form>
  );
}
