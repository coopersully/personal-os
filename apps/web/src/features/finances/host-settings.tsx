import type { AutomationHostSchedule, AutomationHostSurface } from "@personal-os/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "../../api.js";
import { QueryFeedback } from "../../components/async-state.js";

export function FinanceHostSettings() {
  const queryClient = useQueryClient();
  const schedules = useQuery({
    queryKey: ["finance-host-schedules"],
    queryFn: api.listAutomationHostSchedules,
  });
  const connections = useQuery({
    queryKey: ["finance-host-connections"],
    queryFn: api.listAutomationHostConnections,
  });
  const answers = useQuery({
    queryKey: ["finance-answer-continuations"],
    queryFn: api.listFinanceAnswerContinuations,
  });
  const runs = useQuery({ queryKey: ["finance-host-runs"], queryFn: api.listFinanceHostRuns });
  const [connection, setConnection] = useState("");
  const [surface, setSurface] = useState<AutomationHostSurface>("codex_desktop");
  const [label, setLabel] = useState("Finance maintenance");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function perform(action: () => Promise<unknown>) {
    setPending(true);
    setError(null);
    try {
      await action();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["finance-host-schedules"] }),
        queryClient.invalidateQueries({ queryKey: ["finance-answer-continuations"] }),
        queryClient.invalidateQueries({ queryKey: ["finance-host-runs"] }),
      ]);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "The host change could not be saved. Reload its status.",
      );
    } finally {
      setPending(false);
    }
  }
  const active =
    schedules.data?.filter(
      ({ schedule, connectionAvailable }) =>
        schedule.state === "active" && connectionAvailable !== false,
    ) ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Finance maintenance host</CardTitle>
        <CardDescription>
          Continue accepted answers through your authorized Codex schedule or Claude routine. Your
          host owns its schedule and runs.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <QueryFeedback query={schedules} title="Host schedules could not be loaded" />
        <QueryFeedback query={connections} title="Host connections could not be loaded" />
        <QueryFeedback query={answers} title="Saved answer status could not be loaded" />
        <QueryFeedback query={runs} title="Waiting host runs could not be loaded" />
        {error ? <p role="alert">{error}</p> : null}
        {connections.data?.length ? (
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void perform(() =>
                api.createAutomationHostSchedule({
                  tenantAuthorizationConnectionId: connection,
                  label,
                  requestedScopes: ["finances:maintain"],
                  ...(surface === "codex_desktop"
                    ? {
                        hostSurface: "codex_desktop",
                        trigger: {
                          type: "recurring",
                          recurrence: {
                            type: "interval",
                            everyMinutes: 5,
                            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                          },
                        },
                      }
                    : {
                        hostSurface: "claude_code_routine",
                        trigger: { type: "event", expectedMaximumLatencyMinutes: 5 },
                      }),
                }),
              );
            }}
          >
            <Label htmlFor="finance-host-connection">Authorized host connection</Label>
            <NativeSelect
              id="finance-host-connection"
              required
              value={connection}
              onChange={(event) => setConnection(event.target.value)}
            >
              <NativeSelectOption value="">Choose a connection</NativeSelectOption>
              {connections.data.map((item) => (
                <NativeSelectOption key={item.id} value={item.id}>
                  {item.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Label htmlFor="finance-host-surface">Host</Label>
            <NativeSelect
              id="finance-host-surface"
              value={surface}
              onChange={(event) => setSurface(event.target.value as AutomationHostSurface)}
            >
              <NativeSelectOption value="codex_desktop">Codex desktop</NativeSelectOption>
              <NativeSelectOption value="claude_code_routine">Claude routine</NativeSelectOption>
            </NativeSelect>
            <Label htmlFor="finance-host-label">Name</Label>
            <Input
              id="finance-host-label"
              required
              maxLength={100}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
            <Button type="submit" disabled={pending || !connection}>
              Prepare host setup
            </Button>
          </form>
        ) : connections.isSuccess ? (
          <p>
            Connect your host to nohmi and explicitly authorize Finance maintenance, then reload
            this page.
          </p>
        ) : null}
        {schedules.data?.map(({ schedule, health, connectionAvailable }) => (
          <HostSchedule
            key={schedule.id}
            schedule={schedule}
            health={
              connectionAvailable === false
                ? "Connection unavailable. Reauthorize your host."
                : health.state
            }
            pending={pending}
            perform={perform}
          />
        ))}
        {runs.data?.map((run) => (
          <HostRunRecovery
            key={run.id}
            run={run}
            schedules={active.map((item) => item.schedule)}
            pending={pending}
            perform={perform}
          />
        ))}
        {answers.data
          ?.filter((answer) => answer.state !== "completed")
          .map((answer) => (
            <section key={answer.id} className="grid gap-2 rounded-md border p-3">
              <p>
                Accepted answer:{" "}
                {answer.state === "accepted"
                  ? "Maintenance started"
                  : answer.state === "unavailable"
                    ? "Source unavailable"
                    : answer.automationScheduleId
                      ? "Waiting for the bound host"
                      : "Choose a host to continue"}
              </p>
              <Link
                className="underline"
                to={`/finances/review?case=${encodeURIComponent(answer.reviewCaseId)}`}
              >
                Review source
              </Link>
              {answer.fireState === "uncertain" ||
              answer.fireState === "submitting" ||
              (answer.fireState === "accepted" && !answer.maintenanceRunId) ? (
                <p>Host execution is unconfirmed. Check the routine before starting another run.</p>
              ) : answer.fireState === "unavailable" ? (
                <p>
                  Routine delivery failed. Repair the routine in its host; the answer remains saved.
                </p>
              ) : null}
              {answer.state === "pending" &&
              !answer.maintenanceRunId &&
              (answer.fireState === "uncertain" ||
                answer.fireState === "submitting" ||
                answer.fireState === "accepted") ? (
                <DeliveryRecovery
                  id={answer.id}
                  updatedAt={answer.updatedAt}
                  pending={pending}
                  perform={perform}
                />
              ) : null}
              {(answer.fireState === "pending" || answer.fireState === "unavailable") &&
              answer.state === "pending" ? (
                <NativeSelect
                  aria-label="Choose continuation host"
                  disabled={pending}
                  value=""
                  onChange={(event) => {
                    const id = event.target.value;
                    if (id) void perform(() => api.bindFinanceAnswerContinuation(answer.id, id));
                  }}
                >
                  <NativeSelectOption value="">Choose continuation host</NativeSelectOption>
                  {active.map(({ schedule }) => (
                    <NativeSelectOption key={schedule.id} value={schedule.id}>
                      {schedule.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              ) : null}
            </section>
          ))}
      </CardContent>
    </Card>
  );
}
function HostSchedule({
  schedule,
  health,
  pending,
  perform,
}: {
  schedule: AutomationHostSchedule;
  health: string;
  pending: boolean;
  perform: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [automationId, setAutomationId] = useState("");
  const [next, setNext] = useState("");
  const [token, setToken] = useState("");
  const prompt = `Use the original nohmi connection bound to schedule ${schedule.id}. First read get_finance_continuations for this schedule to obtain its current version and state, following nextCursor while hasMore is true to read every page. Report the actual host state using observe_finance_host_schedule with those expected values and a current observedAt (include the actual next host slot for Codex); never invent an observation. If its continuations list has pending or accepted answers, continue each one with maintain_finances operation continue, its continuationId, and automationScheduleId ${schedule.id}. Follow the returned next action and resume with the saved run ID until that case settles or needs a human decision; do not start a broader run while an answer continuation is outstanding. If no answer continuation is outstanding, start maintain_finances with operation start and automationScheduleId ${schedule.id}, then resume the returned run ID. Read the API-owned Finance playbook when instructed. Never guess answers or self-approve financial changes. Keep financial context inside nohmi; notify me only for decisions, failures, or completion.`;
  return (
    <section className="grid gap-3 rounded-md border p-3" aria-label={schedule.label}>
      <p className="font-medium">{schedule.label}</p>
      <p>{health.replaceAll("_", " ")}</p>
      {schedule.state === "setup_pending" ? (
        <>
          <p>
            {schedule.hostSurface === "codex_desktop"
              ? "Create a recurring Codex automation every 5 minutes using the selected nohmi connection. Paste this prompt, then bind its automation identifier and next scheduled time below."
              : "Create a Claude routine using the selected nohmi connection and this prompt. Add an API trigger, then bind its routine identifier below."}
          </p>
          <Label htmlFor={`host-prompt-${schedule.id}`}>Host prompt</Label>
          <Textarea id={`host-prompt-${schedule.id}`} readOnly value={prompt} />
          <form
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void perform(() =>
                api.bindAutomationHostSchedule(
                  schedule.id,
                  schedule.hostSurface === "codex_desktop"
                    ? {
                        hostSurface: "codex_desktop",
                        expectedVersion: schedule.version,
                        expectedState: "setup_pending",
                        hostAutomationId: automationId,
                        nextExpectedAt: new Date(next).toISOString(),
                      }
                    : {
                        hostSurface: "claude_code_routine",
                        expectedVersion: schedule.version,
                        expectedState: "setup_pending",
                        hostAutomationId: automationId,
                      },
                ),
              );
            }}
          >
            <Label htmlFor={`host-id-${schedule.id}`}>Host automation identifier</Label>
            <Input
              id={`host-id-${schedule.id}`}
              value={automationId}
              onChange={(event) => setAutomationId(event.target.value)}
              required
            />
            {schedule.hostSurface === "codex_desktop" ? (
              <>
                <Label htmlFor={`host-next-${schedule.id}`}>Next host run</Label>
                <Input
                  id={`host-next-${schedule.id}`}
                  type="datetime-local"
                  required
                  value={next}
                  onChange={(event) => setNext(event.target.value)}
                />
              </>
            ) : null}
            <Button type="submit" disabled={pending}>
              Bind host
            </Button>
          </form>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              void perform(() =>
                api.cancelAutomationHostSchedule(schedule.id, {
                  expectedVersion: schedule.version,
                  expectedState: "setup_pending",
                }),
              )
            }
          >
            Cancel setup
          </Button>
        </>
      ) : null}
      {schedule.state === "active" && schedule.hostSurface === "claude_code_routine" ? (
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void perform(async () => {
              await api.saveAutomationHostFireToken(schedule.id, {
                token,
                expectedVersion: schedule.version,
              });
              setToken("");
            });
          }}
        >
          <Label htmlFor={`host-token-${schedule.id}`}>Routine API trigger token</Label>
          <Input
            id={`host-token-${schedule.id}`}
            type="password"
            autoComplete="off"
            required
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
          <Button type="submit" disabled={pending}>
            Save trigger token
          </Button>
        </form>
      ) : null}
      {schedule.state === "active" || schedule.state === "paused" ? (
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => {
            if (schedule.state === "active" || schedule.state === "paused")
              void perform(() =>
                api.revokeAutomationHostSchedule(schedule.id, {
                  expectedVersion: schedule.version,
                  expectedState: schedule.state as "active" | "paused",
                }),
              );
          }}
        >
          Revoke continuation access
        </Button>
      ) : null}
    </section>
  );
}

function DeliveryRecovery({
  id,
  updatedAt,
  pending,
  perform,
}: {
  id: string;
  updatedAt: string;
  pending: boolean;
  perform: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [checked, setChecked] = useState(false);
  return (
    <div className="grid gap-2">
      <Label className="flex gap-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => setChecked(event.target.checked)}
        />
        I checked the owning host; no session is running for this answer.
      </Label>
      <Button
        disabled={pending || !checked}
        onClick={() =>
          void perform(() =>
            api.reconcileFinanceHostDelivery(id, {
              expectedUpdatedAt: updatedAt,
              hostChecked: true,
            }),
          )
        }
      >
        Release unconfirmed delivery
      </Button>
      <p className="text-sm text-muted-foreground">
        This preserves the saved answer. Choose a host afterward to request another attempt.
      </p>
    </div>
  );
}
function HostRunRecovery({
  run,
  schedules,
  pending,
  perform,
}: {
  run: {
    id: string;
    status: string;
    automationScheduleId: string;
    authorizationConnectionId: string;
    updatedAt: string;
  };
  schedules: AutomationHostSchedule[];
  pending: boolean;
  perform: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [checked, setChecked] = useState(false);
  const [selected, setSelected] = useState("");
  return (
    <section className="grid gap-2 rounded-md border p-3" aria-label="Waiting Finance run">
      <p>Finance run: {run.status.replaceAll("_", " ")}</p>
      {run.status === "running" ? (
        <p>This run is executing. Wait for it to release before changing its host.</p>
      ) : (
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void perform(() =>
              api.recoverFinanceHostRun(run.id, {
                scheduleId: selected,
                expectedScheduleId: run.automationScheduleId,
                expectedConnectionId: run.authorizationConnectionId,
                expectedUpdatedAt: run.updatedAt,
                hostChecked: true,
              }),
            );
          }}
        >
          <Label className="flex gap-2">
            <input
              type="checkbox"
              checked={checked}
              onChange={(event) => setChecked(event.target.checked)}
            />
            I checked the original host and stopped its work on this run.
          </Label>
          <NativeSelect
            aria-label="Replacement host for waiting run"
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            <NativeSelectOption value="">Choose a polling Codex host</NativeSelectOption>
            {schedules
              .filter((schedule) => schedule.hostSurface === "codex_desktop")
              .map((schedule) => (
                <NativeSelectOption key={schedule.id} value={schedule.id}>
                  {schedule.label}
                </NativeSelectOption>
              ))}
          </NativeSelect>
          <Button type="submit" disabled={pending || !checked || !selected}>
            Move waiting run to host
          </Button>
          <p className="text-sm text-muted-foreground">
            Resume the saved run in that host. Its questions, approvals and financial evidence
            remain unchanged.
          </p>
        </form>
      )}
    </section>
  );
}
