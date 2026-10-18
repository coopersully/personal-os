import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { api } from "../../api.js";
import { QueryFeedback } from "../../components/async-state.js";
import { SettingsFeedbackContext } from "../../lib/settings-feedback.js";
import {
  type AutomationAction,
  AutomationBinding,
  AutomationRegistration,
  type HostStatus,
} from "./automation-registration.js";
import {
  AutomationHostReadiness,
  AutomationVerification,
  FinanceConversationReadiness,
} from "./automation-verification.js";
import { HostPromptPanel } from "./host-prompt-panel.js";

const date = (value: string | null) => (value ? new Date(value).toLocaleString() : "Not reported");

export function FinanceAutomationsPage() {
  const client = useQueryClient();
  const schedules = useQuery({
    queryKey: ["finance-host-schedules"],
    queryFn: api.listAutomationHostSchedules,
  });
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const perform: AutomationAction = async (action, message) => {
    if (busy.current) return false;
    busy.current = true;
    setPending(true);
    const notice = toast.loading("Saving automation…");
    try {
      await action();
      await Promise.all([
        client.invalidateQueries({ queryKey: ["finance-host-schedules"] }),
        client.invalidateQueries({ queryKey: ["finance-conversation-readiness"] }),
        client.invalidateQueries({ queryKey: ["finance-conversation-host-readiness"] }),
      ]);
      toast.success(message, { id: notice });
      return true;
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "The automation could not be saved. Reload its status and try again.",
        { id: notice },
      );
      return false;
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  return (
    <SettingsFeedbackContext.Provider value={true}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p>One automation can maintain your finances. You can register additional hosts.</p>
          <AutomationRegistration pending={pending} perform={perform} />
        </div>
        <FinanceConversationReadiness />
        <Separator />
        <QueryFeedback query={schedules} title="Automations could not be loaded" />
        {schedules.isSuccess && !schedules.data.length ? (
          <p>No Finance automations registered.</p>
        ) : null}
        {schedules.data?.map((status) => (
          <Automation
            key={status.schedule.id}
            status={status}
            pending={pending}
            perform={perform}
          />
        ))}
      </div>
    </SettingsFeedbackContext.Provider>
  );
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
  const { schedule, health } = status;
  const [label, setLabel] = useState(schedule.label);
  const [removeOpen, setRemoveOpen] = useState(false);
  const live = schedule.state === "active" || schedule.state === "paused";
  return (
    <section aria-label={schedule.label} className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2>{schedule.label}</h2>
        <Badge variant="secondary">{schedule.state.replaceAll("_", " ")}</Badge>
      </div>
      <p>
        {schedule.hostSurface === "codex_desktop" ? "Codex desktop" : "Claude routine"} ·{" "}
        {schedule.trigger.type === "recurring"
          ? `Every ${schedule.trigger.recurrence.everyMinutes} minutes · ${schedule.trigger.recurrence.timeZone}`
          : "Event-based · next run unknown"}
      </p>
      <p>
        {status.connectionAvailable === false
          ? "Connection unavailable. Reauthorize the original host connection."
          : `Schedule health: ${health.state.replaceAll("_", " ")}`}
      </p>
      {schedule.state === "active" && schedule.trigger.type === "recurring" ? (
        <p>
          Next expected start: {date(health.nextExpectedAt)}
          {health.overdueAt ? ` · Overdue threshold: ${date(health.overdueAt)}` : ""}
          {health.graceMilliseconds !== null
            ? ` · Grace: ${Math.round(health.graceMilliseconds / 60000)} minutes`
            : ""}
        </p>
      ) : null}
      <p>
        Host observation: {date(health.lastObservedAt)}. Successful maintenance is not established
        by an observation.
      </p>
      <AutomationHostReadiness scheduleId={schedule.id} />
      <p>Saved instructions do not confirm installation.</p>
      <div className="flex flex-wrap gap-2">
        <HostPromptPanel status={status} />
        <AutomationVerification
          scheduleId={schedule.id}
          disabled={pending || !live || status.connectionAvailable === false}
        />
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline">Details and setup</Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90dvh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{schedule.label}</DialogTitle>
              <DialogDescription>
                nohmi records the expected schedule. Create, change, or stop the external job in its
                host separately.
              </DialogDescription>
            </DialogHeader>
            <dl className="grid min-w-0 gap-2">
              <dt>Registration ID</dt>
              <dd className="break-all">{schedule.id}</dd>
              <dt>Original connection</dt>
              <dd className="break-all">{schedule.tenantAuthorizationConnectionId}</dd>
              <dt>Created</dt>
              <dd>{date(schedule.createdAt)}</dd>
              <dt>Last registration change</dt>
              <dd>{date(schedule.updatedAt)}</dd>
              <dt>Prompt</dt>
              <dd>
                {status.prompt?.latestIssued
                  ? `Saved version ${status.prompt.latestIssued.templateVersion}${status.prompt.upgradeAvailable ? " · Update available" : ""}`
                  : "Not issued"}
              </dd>
            </dl>
            <AutomationBinding status={status} pending={pending} perform={perform} />
            {schedule.state !== "cancelled" && schedule.state !== "revoked" ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void perform(
                    () =>
                      api.updateAutomationHostSchedule(schedule.id, {
                        expectedVersion: schedule.version,
                        label,
                      }),
                    "Automation name saved.",
                  );
                }}
              >
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor={`name-${schedule.id}`}>Name</FieldLabel>
                    <Input
                      id={`name-${schedule.id}`}
                      required
                      maxLength={100}
                      value={label}
                      onChange={(event) => setLabel(event.target.value)}
                    />
                  </Field>
                  <Button disabled={pending}>Save name</Button>
                </FieldGroup>
              </form>
            ) : null}
          </DialogContent>
        </Dialog>
        {schedule.state === "setup_pending" || live ? (
          <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">{live ? "Remove registration" : "Cancel setup"}</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {live ? "Remove this registration?" : "Cancel this setup?"}
                </DialogTitle>
                <DialogDescription>
                  Future dispatch and acceptance under this registration will stop. History stays
                  available. Remove the external job in its host separately.
                </DialogDescription>
              </DialogHeader>
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() => {
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
                    "Registration removed. Stop the external job in its host.",
                  ).then((saved) => {
                    if (saved) setRemoveOpen(false);
                  });
                }}
              >
                Confirm {live ? "removal" : "cancellation"}
              </Button>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>
      <Separator />
    </section>
  );
}
