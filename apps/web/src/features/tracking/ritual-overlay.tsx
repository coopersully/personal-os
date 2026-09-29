import {
  latestRitualResponses,
  type RitualActionInput,
  type RitualActionResult,
  type RitualResponseInput,
  type RitualState,
  ritualAnswerIsValid,
} from "@personal-os/domain";
import { useEffect, useRef, useState } from "react";
import { errorMessage } from "../../api.js";
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
  const occurrenceId = state?.current?.id;
  useEffect(() => {
    if (!occurrenceId) return;
    let cancelled = false;
    void (async () => {
      await document.fonts.ready;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      if (cancelled) return;
      await ritualContentReady(occurrenceId);
      if (!cancelled) setReadyId(occurrenceId);
    })().catch((e) => {
      if (!cancelled) setError(errorMessage(e));
    });
    return () => {
      cancelled = true;
    };
  }, [occurrenceId]);
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
            setError(errorMessage(e));
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
    <main
      className="ritual-surface"
      data-ritual-kind={state?.current?.definition.kind}
      data-ready={Boolean(occurrenceId && readyId === occurrenceId)}
    >
      {state?.preview ? (
        <RitualPreviewChecklist initialState={state} onClose={() => void showRitualPreview(null)} />
      ) : state ? (
        <RitualChecklist
          key={state.current?.id ?? "empty"}
          state={state}
          saveResponse={(stepId, input) => submitRitualResponse(state.current!.id, stepId, input)}
          act={(input) => submitRitualAction(state.current!.id, input)}
        />
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </main>
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
      setError(errorMessage(e));
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
      setError(errorMessage(e));
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
  if (!occurrence || occurrence.status !== "pending")
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <h1>{occurrence?.status === "completed" ? "All done." : "You’re up to date."}</h1>
        <p className="text-muted-foreground">Your next ritual will appear when it’s due.</p>
      </div>
    );
  const answers = latestRitualResponses(occurrence);
  const complete = occurrence.definition.steps.filter(
    (s) => answers[s.id]?.submitted && ritualAnswerIsValid(s, answers[s.id]!.value),
  ).length;
  const dirty = Object.entries(texts).some(([id, value]) => value !== answers[id]?.value);
  const ready = complete === occurrence.definition.steps.length && !dirty && !busy;
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
                </li>
              ))}
            </ul>
          )}
        </CardContent>
        <CardFooter className="shrink-0 flex-col gap-3 text-center">
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
                : `${complete} of ${occurrence.definition.steps.length} tasks completed`}
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
