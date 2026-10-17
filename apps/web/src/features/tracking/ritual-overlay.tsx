import {
  defaultRitualReminderTime,
  latestRitualResponses,
  localDateAt,
  localDateToIso,
  nextRitualReminderAt,
  type RitualActionInput,
  type RitualActionResult,
  type RitualResponseInput,
  type RitualState,
  ritualAnswerIsValid,
  ritualIsAnswered,
  unfinishedOptionalRitualSteps,
} from "@personal-os/domain";
import { useEffect, useRef, useState } from "react";
import { NohmiBrandMark } from "../../components/brand-marks.js";
import { AlertTriangleIcon, CheckIcon, ClockIcon } from "../../components/icons.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent, CardFooter } from "../../components/ui/card.js";
import { Checkbox } from "../../components/ui/checkbox.js";
import { Field, FieldLabel, FieldLegend, FieldSet } from "../../components/ui/field.js";
import { Input } from "../../components/ui/input.js";
import { RadioGroup, RadioGroupItem } from "../../components/ui/radio-group.js";
import { Spinner } from "../../components/ui/spinner.js";
import { Textarea } from "../../components/ui/textarea.js";
import { classifyMutationError } from "../../lib/feedback.js";
import {
  readRitualState,
  ritualContentReady,
  ritualDeviceId,
  showRitualPreview,
  submitRitualAction,
  submitRitualResponse,
} from "../desktop/ritual-bridge.js";
import { RitualPreviewChecklist } from "./ritual-preview.js";
export function RitualOverlay() {
  const [state, setState] = useState<RitualState | null>(null);
  const [readyId, setReadyId] = useState<string | null>(null);
  const [readinessError, setReadinessError] = useState("");
  const occurrenceId = state?.current?.id;
  useEffect(() => {
    setReadinessError("");
    if (!occurrenceId || readyId === occurrenceId) return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    async function prepare() {
      try {
        await document.fonts.ready;
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        if (cancelled) return;
        await ritualContentReady(occurrenceId!);
        if (!cancelled) {
          setReadinessError("");
          setReadyId(occurrenceId!);
        }
      } catch (e) {
        if (!cancelled) {
          setReadinessError(
            classifyMutationError(e, {
              action: "prepare this ritual",
              safeToRetry: true,
            }).message,
          );
          retry = setTimeout(() => void prepare(), 1000);
        }
      }
    }
    void prepare();
    return () => {
      cancelled = true;
      clearTimeout(retry);
    };
  }, [occurrenceId, readyId]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const refresh = () =>
      readRitualState()
        .then((s) => {
          if (active) {
            setState(s);
            setError("");
          }
        })
        .catch((e) => {
          if (active) {
            setState(null);
            setError(
              classifyMutationError(e, {
                action: "load this ritual",
                safeToRetry: true,
              }).message,
            );
          }
        });
    void refresh();
    const timer = setInterval(() => void refresh(), 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  return (
    <>
      {readinessError || error ? (
        <p
          role="alert"
          className="fixed inset-x-4 top-4 z-50 rounded-lg bg-background p-3 text-center"
        >
          {readinessError || error}
        </p>
      ) : null}
      <main
        className="ritual-surface"
        data-ritual-kind={state?.current?.definition.kind}
        data-ready={Boolean(occurrenceId && readyId === occurrenceId)}
      >
        {state?.preview ? (
          <RitualPreviewChecklist
            initialState={state}
            onClose={() => void showRitualPreview(null)}
          />
        ) : state ? (
          <RitualChecklist
            key={state.current?.id ?? "empty"}
            state={state}
            saveResponse={(stepId, input) => submitRitualResponse(state.current!.id, stepId, input)}
            act={(input) => submitRitualAction(state.current!.id, input)}
          />
        ) : null}
      </main>
    </>
  );
}
export function RitualChecklist({
  state: external,
  saveResponse,
  act,
  preview = false,
}: {
  state: RitualState;
  preview?: boolean;
  saveResponse: (stepId: string, input: RitualResponseInput) => Promise<RitualState>;
  act: (input: RitualActionInput) => Promise<RitualActionResult>;
}) {
  const [state, setState] = useState(external);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [challenge, setChallenge] = useState<{
    count: number;
    id: string;
    unavailable?: boolean | undefined;
  } | null>(null);
  const [remindLater, setRemindLater] = useState(false);
  const [reminderTime, setReminderTime] = useState(() =>
    external.current ? defaultRitualReminderTime(external.current.definition) : "12:00",
  );
  const [texts, setTexts] = useState<Record<string, string>>({});
  const failedDrafts = useRef<
    Record<string, { value: string | boolean; occurrenceId: string; revision: number }>
  >({});
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    if (
      !busy &&
      (external.current?.id !== stateRef.current.current?.id ||
        (external.current?.revision ?? 0) >= (stateRef.current.current?.revision ?? 0))
    )
      setState(external);
  }, [external, busy]);
  const occurrence = state.current;
  function input() {
    return {
      requestId: crypto.randomUUID(),
      deviceId: ritualDeviceId(),
      expectedRevision: stateRef.current.current!.revision,
      observedAt: new Date().toISOString(),
    };
  }
  async function respond(stepId: string, value: string | boolean, submitted: boolean) {
    setBusy(true);
    setError("");
    const attempt = input();
    const occurrenceId = stateRef.current.current!.id;
    try {
      const next = await saveResponse(stepId, { ...attempt, value, submitted });
      delete failedDrafts.current[stepId];
      setState(next);
      const accepted = next.current && latestRitualResponses(next.current)[stepId];
      if (accepted?.value === value && accepted.submitted === submitted) {
        setTexts((drafts) => {
          if (drafts[stepId] !== value) return drafts;
          const remaining = { ...drafts };
          delete remaining[stepId];
          return remaining;
        });
      }
    } catch (e) {
      failedDrafts.current[stepId] = { value, occurrenceId, revision: attempt.expectedRevision };
      setError(
        classifyMutationError(e, {
          action: "save your ritual answers",
          form: true,
          safeToRetry: false,
        }).message,
      );
    } finally {
      setBusy(false);
    }
  }
  async function escapeAction(kind: RitualActionInput["kind"]) {
    setBusy(true);
    setError("");
    try {
      const result = await act({
        ...input(),
        kind,
        ...(kind === "complete" &&
        remindLater &&
        stateRef.current.current &&
        unfinishedOptionalRitualSteps(stateRef.current.current).length
          ? {
              optionalReminderAt: nextRitualReminderAt(
                stateRef.current.current.definition,
                reminderTime,
                new Date().toISOString(),
              )!,
            }
          : {}),
        ...(challenge
          ? {
              challengeId: challenge.id,
              displayedCount: challenge.count,
              historyUnavailable: challenge.unavailable ?? false,
            }
          : {}),
      });
      setState(result.state);
      if (result.outcome === "confirmation_required")
        setChallenge({
          count: result.count,
          id: result.challengeId,
          unavailable: result.historyUnavailable,
        });
      else {
        setChallenge(null);
        if (result.outcome === "conflict") setError("This ritual changed. Please try again.");
      }
    } catch (e) {
      setError(
        classifyMutationError(e, {
          action: "save your ritual answers",
          form: true,
          safeToRetry: false,
        }).message,
      );
    } finally {
      setBusy(false);
    }
  }
  const respondRef = useRef(respond);
  respondRef.current = respond;
  const escapeRef = useRef(escapeAction);
  escapeRef.current = escapeAction;
  useEffect(() => {
    const current = occurrence;
    if (busy || !current || current.status !== "pending") return;
    const answers = latestRitualResponses(current);
    const draft = Object.entries(texts).find(([id, value]) => {
      const failed = failedDrafts.current[id];
      return (
        value !== answers[id]?.value &&
        !(
          failed?.value === value &&
          failed.occurrenceId === current.id &&
          failed.revision === current.revision
        )
      );
    });
    if (!draft) return;
    const timer = setTimeout(
      () =>
        void respondRef.current(
          draft[0],
          draft[1],
          ritualAnswerIsValid(
            current.definition.steps.find((step) => step.id === draft[0])!,
            draft[1],
          ),
        ),
      250,
    );
    return () => clearTimeout(timer);
  }, [texts, busy, occurrence]);
  useEffect(() => {
    if (!challenge) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        void escapeRef.current("cancel_snooze");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [challenge, busy]);
  if (occurrence?.status !== "pending")
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <h1>{occurrence?.status === "completed" ? "All done." : "You’re up to date."}</h1>
        <p className="text-muted-foreground">Your next ritual will appear when it’s due.</p>
      </div>
    );
  const answers = latestRitualResponses(occurrence);
  const required = occurrence.definition.steps.filter((step) => !step.optional);
  const complete = required.filter(
    (s) => answers[s.id]?.submitted && ritualAnswerIsValid(s, answers[s.id]!.value),
  ).length;
  const optional = unfinishedOptionalRitualSteps(occurrence);
  const reminderAt = optional.length
    ? nextRitualReminderAt(occurrence.definition, reminderTime, new Date().toISOString())
    : null;
  const reminderDay =
    reminderAt &&
    localDateToIso(localDateAt(new Date(reminderAt), occurrence.timeZone)) !==
      localDateToIso(localDateAt(new Date(), occurrence.timeZone))
      ? "Tomorrow"
      : "Today";
  const dirty = Object.entries(texts).some(([id, value]) => value !== answers[id]?.value);
  const ready =
    ritualIsAnswered(occurrence) &&
    !dirty &&
    !busy &&
    (!remindLater || !optional.length || !!reminderAt);
  return (
    <div className="ritual-presentation">
      <div className="ritual-logo">
        <NohmiBrandMark symbol />
      </div>
      <h1 className="sr-only">{occurrence.definition.title}</h1>
      <Card className="ritual-card">
        <CardContent className="ritual-scroll flex min-h-0 flex-col gap-5 overflow-y-auto text-left">
          {challenge ? (
            <section
              className="flex flex-col items-center gap-4 text-center"
              aria-label="Confirm snooze"
            >
              <p>
                {challenge.unavailable
                  ? `Recent snooze history is unavailable. This device has recorded ${challenge.count} snoozes in the last 3 days. Snooze another 10 minutes?`
                  : `You’ve snoozed your ${occurrence.definition.kind === "night" ? "evening" : "morning"} ritual ${challenge.count} times in the last 3 days. Snooze another 10 minutes?`}
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button disabled={busy} onClick={() => void escapeAction("confirm_snooze")}>
                  Snooze 10 minutes
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void escapeAction("cancel_snooze")}
                >
                  Go back
                </Button>
              </div>
            </section>
          ) : (
            <ul className="flex flex-col gap-5">
              {occurrence.definition.steps.map((step) => (
                <li key={step.id} className="flex flex-col gap-2">
                  <Field orientation={step.kind === "checkbox" ? "horizontal" : "vertical"}>
                    {step.kind === "checkbox" ? (
                      <>
                        <Checkbox
                          id={step.id}
                          disabled={busy}
                          checked={answers[step.id]?.value === true}
                          onCheckedChange={(v) => void respond(step.id, v === true, true)}
                        />
                        <FieldLabel htmlFor={step.id}>{step.label}</FieldLabel>
                      </>
                    ) : (
                      <>
                        {step.kind !== "multiple_choice" ? (
                          <FieldLabel htmlFor={step.id}>{step.label}</FieldLabel>
                        ) : null}
                        {step.kind === "short_text" ? (
                          <Textarea
                            id={step.id}
                            maxLength={5000}
                            value={texts[step.id] ?? String(answers[step.id]?.value ?? "")}
                            onChange={(e) =>
                              setTexts((old) => ({ ...old, [step.id]: e.target.value }))
                            }
                          />
                        ) : step.kind === "multiple_choice" ? (
                          <FieldSet>
                            <FieldLegend>{step.label}</FieldLegend>
                            <RadioGroup
                              aria-label={step.label}
                              value={String(answers[step.id]?.value ?? "")}
                              disabled={busy}
                              onValueChange={(value) => void respond(step.id, value, true)}
                            >
                              {step.options?.map((option, index) => (
                                <Field key={option} orientation="horizontal">
                                  <RadioGroupItem id={`${step.id}-${index}`} value={option} />
                                  <FieldLabel htmlFor={`${step.id}-${index}`}>{option}</FieldLabel>
                                </Field>
                              ))}
                            </RadioGroup>
                          </FieldSet>
                        ) : (
                          <Input
                            id={step.id}
                            type={step.kind}
                            step={step.kind === "number" ? "any" : undefined}
                            value={texts[step.id] ?? String(answers[step.id]?.value ?? "")}
                            onChange={(e) =>
                              setTexts((old) => ({ ...old, [step.id]: e.target.value }))
                            }
                          />
                        )}
                      </>
                    )}
                  </Field>
                  {step.optional ? (
                    <span className="text-xs text-muted-foreground">Optional</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
        <CardFooter className="shrink-0 flex-col gap-3 text-center">
          {!challenge && optional.length > 0 ? (
            <div className="flex w-full flex-col gap-2 text-left">
              <div className="flex flex-wrap items-end gap-3">
                <Field orientation="horizontal" className="flex-1">
                  <Checkbox
                    id="ritual-remind-later"
                    checked={remindLater}
                    disabled={busy}
                    onCheckedChange={(value) => setRemindLater(value === true)}
                  />
                  <FieldLabel htmlFor="ritual-remind-later">Remind me about these later</FieldLabel>
                </Field>
                <Field className="w-auto">
                  <FieldLabel htmlFor="ritual-reminder-time">Reminder time</FieldLabel>
                  <Input
                    id="ritual-reminder-time"
                    type="time"
                    value={reminderTime}
                    disabled={!remindLater || busy}
                    onChange={(event) => setReminderTime(event.target.value)}
                  />
                </Field>
              </div>
              <p className="text-xs text-muted-foreground">
                {remindLater
                  ? `${reminderDay} · ${occurrence.timeZone}. Reminders need account sync and follow your notification settings.`
                  : "Unfinished optional steps will be marked not done for today."}
              </p>
            </div>
          ) : null}
          {!challenge ? (
            <Button
              className="h-auto w-full flex-col gap-1 py-3"
              disabled={!ready}
              onClick={() => {
                if (ready) void escapeAction("complete");
              }}
            >
              {ready
                ? `Complete ${occurrence.definition.kind === "night" ? "Evening" : "Morning"} Ritual`
                : `${complete} of ${required.length} tasks completed`}
            </Button>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
        </CardFooter>
      </Card>
      <div className="ritual-support flex shrink-0 flex-col items-center gap-1">
        <p
          role="status"
          className="ritual-support-text inline-flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground"
        >
          {busy || dirty ? (
            <Spinner aria-hidden="true" className="size-3" />
          ) : state.syncStatus === "conflict" ? (
            <AlertTriangleIcon aria-hidden="true" className="size-3" />
          ) : state.syncStatus === "queued" ? (
            <ClockIcon aria-hidden="true" className="size-3" />
          ) : (
            <CheckIcon aria-hidden="true" className="size-3" />
          )}
          {preview
            ? "Preview only"
            : busy || dirty
              ? "Saving"
              : state.syncStatus === "queued"
                ? "Saved on this Mac and waiting to sync"
                : state.syncStatus === "conflict"
                  ? "Changes need review in Ritual settings"
                  : "Saved to your account"}
        </p>
        {preview ? (
          <Button
            size="sm"
            variant="link"
            className="ritual-support-text text-xs font-normal text-muted-foreground"
            onClick={() => void escapeAction("skip")}
          >
            Close preview
          </Button>
        ) : !challenge ? (
          <div className="ritual-escapes flex shrink-0 justify-center gap-5 text-center">
            <Button
              size="sm"
              variant="link"
              className="ritual-support-text text-xs font-normal text-muted-foreground"
              disabled={busy || dirty}
              onClick={() => void escapeAction("snooze")}
            >
              Snooze
            </Button>
            <Button
              size="sm"
              variant="link"
              className="ritual-support-text text-xs font-normal text-muted-foreground"
              disabled={busy || dirty}
              onClick={() => void escapeAction("skip")}
            >
              Skip for Today
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
