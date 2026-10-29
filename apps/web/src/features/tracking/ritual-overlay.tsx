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
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { NohmiBrandMark } from "../../components/brand-marks.js";
import {
  AlertTriangleIcon,
  CheckIcon,
  ClockIcon,
  FireIcon,
  LockIcon,
} from "../../components/icons.js";
import { Field, FieldLabel, FieldLegend, FieldSet } from "../../components/settings-field.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent, CardFooter } from "../../components/ui/card.js";
import { Checkbox } from "../../components/ui/checkbox.js";
import { Input } from "../../components/ui/input.js";
import { RadioGroup, RadioGroupItem } from "../../components/ui/radio-group.js";
import { Toaster } from "../../components/ui/sonner.js";
import { Spinner } from "../../components/ui/spinner.js";
import { Textarea } from "../../components/ui/textarea.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../components/ui/tooltip.js";
import { classifyMutationError } from "../../lib/feedback.js";
import {
  readRitualState,
  ritualContentReady,
  ritualDeviceId,
  showRitualPreview,
  submitRitualAction,
  submitRitualResponse,
} from "../desktop/ritual-bridge.js";
import { RitualCardHeader } from "./ritual-card-header.js";
import { RitualCompletionWeek } from "./ritual-completion-week.js";
import { RitualEscapeSummary } from "./ritual-escape-summary.js";
import { RitualPreviewChecklist } from "./ritual-preview.js";
import { RitualSkipConfirmation } from "./ritual-skip-confirmation.js";
import { RitualWeatherSky } from "./ritual-weather-sky.js";
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
      <Toaster position="bottom-center" />
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
  onPreviewDateChange,
}: {
  state: RitualState;
  preview?: boolean;
  onPreviewDateChange?: ((date: string) => void) | undefined;
  saveResponse: (stepId: string, input: RitualResponseInput) => Promise<RitualState>;
  act: (input: RitualActionInput) => Promise<RitualActionResult>;
}) {
  const [state, setState] = useState(external);
  const [busy, setBusy] = useState(false);
  const [hasFailedSave, setHasFailedSave] = useState(false);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const actionToast = useId();
  const completionHint = useId();
  const showError = (message: string) => toast.error(message, { id: actionToast });
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
  const questionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (
      !occurrence?.id ||
      !occurrence.scheduledLocalDate ||
      challenge ||
      confirmSkip ||
      confirmComplete
    )
      return;
    const frame = window.requestAnimationFrame(() => {
      questionsRef.current
        ?.querySelector<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])",
        )
        ?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [occurrence?.id, occurrence?.scheduledLocalDate, challenge, confirmSkip, confirmComplete]);
  const draftDate = useRef(occurrence?.scheduledLocalDate);
  useEffect(() => {
    if (draftDate.current === occurrence?.scheduledLocalDate) return;
    draftDate.current = occurrence?.scheduledLocalDate;
    setTexts({});
  }, [occurrence?.scheduledLocalDate]);
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
    toast.dismiss(actionToast);
    const attempt = input();
    const occurrenceId = stateRef.current.current!.id;
    try {
      const next = await saveResponse(stepId, { ...attempt, value, submitted });
      delete failedDrafts.current[stepId];
      setHasFailedSave(false);
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
      setHasFailedSave(true);
      toast.error(
        classifyMutationError(e, {
          action: "save your ritual answers",
          form: true,
          safeToRetry: false,
        }).message,
        {
          id: actionToast,
          action: {
            label: "Retry",
            onClick: () => {
              if (
                stateRef.current.current?.id === occurrenceId &&
                failedDrafts.current[stepId]?.value === value
              ) {
                void respondRef.current(stepId, value, submitted);
              }
            },
          },
        },
      );
    } finally {
      setBusy(false);
    }
  }
  async function escapeAction(kind: RitualActionInput["kind"]) {
    setBusy(true);
    toast.dismiss(actionToast);
    const requestingReminders =
      kind === "complete" &&
      remindLater &&
      !!stateRef.current.current &&
      unfinishedOptionalRitualSteps(stateRef.current.current).length > 0;
    if (requestingReminders && !preview) toast.loading("Finishing ritual…", { id: actionToast });
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
      setConfirmSkip(false);
      if (result.outcome === "applied") setConfirmComplete(false);
      if (requestingReminders && !preview && result.outcome === "applied") {
        const followUp = result.state.current?.optionalFollowUp;
        if (result.state.syncStatus === "queued")
          toast.success("Ritual saved on this Mac. Reminders are waiting to sync.", {
            id: actionToast,
          });
        else if (followUp?.reminderIds?.length)
          toast.success("Ritual complete. Reminders saved.", { id: actionToast });
        else
          showError("Ritual complete, but reminders could not be confirmed. Check ritual history.");
      }
      if (result.outcome === "confirmation_required")
        setChallenge({
          count: result.count,
          id: result.challengeId,
          unavailable: result.historyUnavailable,
        });
      else {
        setChallenge(null);
        if (result.outcome === "conflict") showError("This ritual changed. Please try again.");
      }
    } catch (e) {
      showError(
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
  useEffect(() => {
    if (!confirmComplete) return;
    const back = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        setConfirmComplete(false);
      }
    };
    window.addEventListener("keydown", back);
    return () => window.removeEventListener("keydown", back);
  }, [confirmComplete, busy]);
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
  const optionalTotal = occurrence.definition.steps.length - required.length;
  const optionalComplete = optionalTotal - optional.length;
  const requirementsMet = ritualIsAnswered(occurrence);
  const dirty = Object.entries(texts).some(([id, value]) => value !== answers[id]?.value);
  const failedText =
    hasFailedSave &&
    Object.entries(texts).find(
      ([id, value]) =>
        failedDrafts.current[id]?.value === value &&
        failedDrafts.current[id]?.occurrenceId === occurrence.id,
    );
  const ready =
    requirementsMet && !dirty && !busy && (!remindLater || !optional.length || !!reminderAt);
  const mainScreen = !challenge && !confirmSkip && !confirmComplete;
  const actions = (
    <section
      aria-label="Ritual actions"
      className="ritual-actions flex w-full shrink-0 flex-col gap-3 text-center"
    >
      {confirmComplete && optional.length > 0 ? (
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
      {!challenge && !confirmSkip ? (
        <>
          <Button
            aria-label={preview ? "Close Preview" : "Done"}
            aria-describedby={preview ? undefined : completionHint}
            className="relative h-auto w-full flex-col gap-1 overflow-hidden py-3"
            disabled={!preview && !ready}
            onClick={() => {
              if (preview) {
                void escapeAction("skip");
                return;
              }
              if (!ready) return;
              if (optional.length && !confirmComplete) setConfirmComplete(true);
              else void escapeAction("complete");
            }}
          >
            {!preview ? (
              <span
                aria-hidden="true"
                className="ritual-button-progress"
                style={{ width: `${required.length ? (complete / required.length) * 100 : 100}%` }}
              />
            ) : null}
            <span className="relative inline-flex items-center gap-2">
              {!preview && !requirementsMet ? (
                <LockIcon aria-hidden="true" className="size-4" />
              ) : null}
              {preview ? "Close Preview" : "Done"}
            </span>
            {!preview ? (
              <span
                id={completionHint}
                className="relative text-xs font-normal text-primary-foreground/70"
              >
                {requirementsMet
                  ? `${complete} required completed · ${optionalComplete} optional completed`
                  : `${required.length - complete} required left`}
              </span>
            ) : null}
          </Button>
          {confirmComplete ? (
            <Button variant="ghost" disabled={busy} onClick={() => setConfirmComplete(false)}>
              Go back
            </Button>
          ) : null}
        </>
      ) : null}
    </section>
  );
  const presentation = (
    <div className="ritual-presentation">
      <div className="ritual-logo">
        <NohmiBrandMark symbol />
      </div>
      <h1 className="sr-only">{occurrence.definition.title}</h1>
      {!preview && mainScreen ? (
        <TooltipProvider>
          <section
            className="ritual-progress flex w-full shrink-0 items-center justify-between gap-4"
            aria-label="Ritual progress"
          >
            <div>
              {state.streakCount !== undefined ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      className="gap-1.5 px-1"
                      aria-label={`${state.streakCount}-day ${occurrence.definition.kind === "night" ? "evening" : "morning"} streak`}
                    >
                      <FireIcon aria-hidden="true" className="size-5" />
                      <span className="text-lg font-medium">{state.streakCount}</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {state.streakCount}-day streak
                    {state.syncStatus === "queued" ? " · Last synced" : ""}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <span className="sr-only">
                  {state.streakCount === undefined
                    ? "Streak history unavailable"
                    : "No current streak"}
                </span>
              )}
            </div>
            {state.completionWeek?.length ? (
              <RitualCompletionWeek
                days={state.completionWeek}
                queued={state.syncStatus === "queued"}
              />
            ) : null}
          </section>
        </TooltipProvider>
      ) : null}
      {confirmSkip ? (
        <RitualSkipConfirmation
          key={occurrence.id}
          count={state.syncStatus === "saved" ? state.skipCount : undefined}
          streak={state.streakCount}
          busy={busy}
          onConfirm={() => void escapeAction("skip")}
          onCancel={() => setConfirmSkip(false)}
        />
      ) : challenge ? (
        <Card
          key="snooze"
          className="ritual-card ritual-screen"
          role="region"
          aria-label="Confirm snooze"
        >
          <CardContent className="ritual-scroll flex min-h-0 flex-col items-center gap-7 overflow-y-auto text-center">
            <RitualEscapeSummary streak={state.streakCount}>
              {challenge.unavailable
                ? `Recent snooze history is unavailable. This device has recorded ${challenge.count} snoozes in the last 3 days.`
                : `You’ve snoozed your ${occurrence.definition.kind === "night" ? "evening" : "morning"} ritual ${challenge.count} times in the last 3 days.`}{" "}
              Snooze another 10 minutes, or go back to continue your ritual now.
            </RitualEscapeSummary>
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void escapeAction("confirm_snooze")}
              >
                Snooze 10 minutes
              </Button>
              <Button disabled={busy} onClick={() => void escapeAction("cancel_snooze")}>
                Go back
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : confirmComplete ? (
        <section
          aria-label="Finish optional steps"
          className="ritual-follow-up flex w-full flex-col gap-4 text-left"
        >
          <h2 className="text-lg font-medium">
            {optional.length} optional {optional.length === 1 ? "step left" : "steps left"}
          </h2>
          <p className="text-sm">
            You can finish your ritual now. Choose whether to get a reminder for the remaining
            steps.
          </p>
        </section>
      ) : (
        <Card
          key="questions"
          className="ritual-card ritual-screen"
          role="region"
          aria-label="Ritual questions"
        >
          <RitualCardHeader
            kind={occurrence.definition.kind}
            timeZone={occurrence.timeZone}
            date={occurrence.scheduledLocalDate}
            required={required.length}
            requiredDone={complete}
            optional={optionalTotal}
            optionalDone={optionalComplete}
            onDateChange={preview ? onPreviewDateChange : undefined}
          />
          <CardContent
            ref={questionsRef}
            className="ritual-scroll min-h-0 overflow-y-auto text-left"
          >
            <ul className="flex flex-col gap-5">
              {occurrence.definition.steps.map((step) => (
                <li key={step.id} className="flex flex-col gap-2">
                  <Field orientation={step.kind === "checkbox" ? "horizontal" : "vertical"}>
                    {step.kind === "checkbox" ? (
                      <>
                        <Checkbox
                          id={step.id}
                          aria-required={!step.optional}
                          disabled={busy}
                          checked={answers[step.id]?.value === true}
                          onCheckedChange={(v) => void respond(step.id, v === true, true)}
                        />
                        <FieldLabel htmlFor={step.id}>
                          {step.label}
                          {!step.optional ? (
                            <span aria-hidden="true" className="text-destructive">
                              *
                            </span>
                          ) : null}
                        </FieldLabel>
                      </>
                    ) : (
                      <>
                        {step.kind !== "multiple_choice" ? (
                          <FieldLabel htmlFor={step.id}>
                            {step.label}
                            {!step.optional ? (
                              <span aria-hidden="true" className="text-destructive">
                                *
                              </span>
                            ) : null}
                          </FieldLabel>
                        ) : null}
                        {step.kind === "short_text" ? (
                          <Textarea
                            id={step.id}
                            maxLength={5000}
                            required={!step.optional}
                            placeholder="Your answer…"
                            value={texts[step.id] ?? String(answers[step.id]?.value ?? "")}
                            onChange={(e) =>
                              setTexts((old) => ({ ...old, [step.id]: e.target.value }))
                            }
                          />
                        ) : step.kind === "multiple_choice" ? (
                          <FieldSet>
                            <FieldLegend>
                              {step.label}
                              {!step.optional ? (
                                <span aria-hidden="true" className="text-destructive">
                                  {" "}
                                  *
                                </span>
                              ) : null}
                            </FieldLegend>
                            <RadioGroup
                              aria-label={step.label}
                              aria-required={!step.optional}
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
                            required={!step.optional}
                            placeholder={
                              step.kind === "number"
                                ? "Enter a number"
                                : step.kind === "time"
                                  ? "HH:MM"
                                  : "YYYY-MM-DD"
                            }
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
                </li>
              ))}
            </ul>
          </CardContent>
          <CardFooter className="shrink-0">{actions}</CardFooter>
        </Card>
      )}
      {!mainScreen ? actions : null}
      {!preview ? (
        <div className="ritual-support flex shrink-0 flex-col items-center gap-1">
          {mainScreen && !preview ? (
            <p
              role="status"
              className="ritual-support-text inline-flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground"
            >
              {busy ? (
                <Spinner aria-hidden="true" className="size-3" />
              ) : state.syncStatus === "conflict" ? (
                <AlertTriangleIcon aria-hidden="true" className="size-3" />
              ) : state.syncStatus === "queued" ? (
                <ClockIcon aria-hidden="true" className="size-3" />
              ) : (
                <CheckIcon aria-hidden="true" className="size-3" />
              )}
              {busy
                ? "Saving"
                : dirty
                  ? "Unsaved changes"
                  : state.syncStatus === "queued"
                    ? "Saved on this Mac and waiting to sync"
                    : state.syncStatus === "conflict"
                      ? "Changes need review in Ritual settings"
                      : "Saved to your account"}
            </p>
          ) : null}
          {mainScreen && !preview && failedText && !busy ? (
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  failedDrafts.current = {};
                  setHasFailedSave(false);
                  setTexts({});
                  toast.dismiss(actionToast);
                }}
              >
                Discard unsaved changes
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  void respondRef.current(
                    failedText[0],
                    failedText[1],
                    ritualAnswerIsValid(
                      occurrence.definition.steps.find((step) => step.id === failedText[0])!,
                      failedText[1],
                    ),
                  )
                }
              >
                Retry saving
              </Button>
            </div>
          ) : null}

          {!preview && !challenge && !confirmSkip && !confirmComplete ? (
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
                onClick={() => setConfirmSkip(true)}
              >
                Skip for Today
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
  return (
    <>
      <RitualWeatherSky
        key={occurrence.id}
        occurrenceId={occurrence.id}
        kind={occurrence.definition.kind}
        timeZone={occurrence.timeZone}
      />
      {presentation}
    </>
  );
}
