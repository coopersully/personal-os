import {
  deriveFinanceOnboardingReadiness,
  type FinanceOnboardingAdapter,
  type FinanceOnboardingBlocker,
  type FinanceOnboardingDisposition,
  type FinanceOnboardingSnapshot,
} from "@personal-os/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { ChoiceCardGroup } from "@/components/choice-card-group";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect } from "@/components/ui/native-select";
import { FinanceSetupAgentGuidance } from "./setup-agent-guidance.js";

const blockerCopy: Record<FinanceOnboardingBlocker, string> = {
  source_required: "Add an account or import records to continue.",
  ownership_required: "Review account ownership to continue.",
  source_unavailable: "Your financial records could not be checked.",
  context_review_required: "Review each financial context answer.",
  context_unavailable: "Your financial context could not be checked.",
  display_review_required: "Review your display preferences.",
  automation_choice_required: "Choose whether to set up automation now or later.",
  registration_required: "Connect an authorized agent and choose its cadence, or select Later.",
};

/** Mount only with a durable server adapter; local drafts never unlock the workspace. */
export function FinanceOnboardingReview({
  adapter,
  continueTo,
}: {
  adapter: FinanceOnboardingAdapter;
  continueTo?: string;
}) {
  const client = useQueryClient();
  const [reload, setReload] = useState(0);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const query = useQuery({
    queryKey: ["finance-onboarding", adapter],
    queryFn: async ({ signal }) => {
      const refreshing = client.getQueryData(["finance-onboarding", adapter]) !== undefined;
      const id = toast.loading(refreshing ? "Reloading setup review…" : "Loading setup review…");
      const onAbort = () => toast.dismiss(id);
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
      try {
        const next = await adapter.getFinanceOnboarding();
        if (!signal.aborted) {
          if (refreshing) toast.success("Setup review reloaded", { id });
          else toast.dismiss(id);
        }
        return next;
      } catch (error) {
        if (!signal.aborted)
          toast.error(
            refreshing
              ? "Setup review could not reload. Your edits are still here."
              : "Setup review could not load. Try again.",
            { id },
          );
        throw error;
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
    },
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  if (!query.data)
    return (
      <section aria-label="Setup review" className="grid gap-4 rounded-lg bg-card p-4">
        <h2 className="font-medium">Review your setup</h2>
        {query.isError ? (
          <Button disabled={query.isFetching} onClick={() => void query.refetch()}>
            Retry setup review
          </Button>
        ) : null}
      </section>
    );
  return (
    <ReviewSnapshot
      key={`${query.data.revision}:${reload}`}
      adapter={adapter}
      {...(continueTo === undefined ? {} : { continueTo })}
      snapshot={query.data}
      onSnapshot={(next) => client.setQueryData(["finance-onboarding", adapter], next)}
      reloading={query.isFetching}
      onReload={async () => {
        const result = await query.refetch();
        if (!result.isError && mounted.current) setReload((value) => value + 1);
      }}
    />
  );
}

function ReviewSnapshot({
  adapter,
  snapshot: initial,
  onReload,
  onSnapshot,
  reloading,
  continueTo,
}: {
  adapter: FinanceOnboardingAdapter;
  continueTo?: string;
  snapshot: FinanceOnboardingSnapshot;
  onReload: () => Promise<void>;
  reloading: boolean;
  onSnapshot: (snapshot: FinanceOnboardingSnapshot) => void;
}) {
  const controlId = useId();
  const [snapshot, setSnapshot] = useState(initial);
  const [mustReload, setMustReload] = useState(false);
  const [answers, setAnswers] = useState<Record<string, FinanceOnboardingDisposition>>(() =>
    Object.fromEntries(
      initial.questions.map((question) => [question.questionId, question.disposition]),
    ),
  );
  const [displayReviewed, setDisplayReviewed] = useState(initial.displayPreferences.reviewed);
  const [choice, setChoice] = useState(initial.automationChoice);
  const readiness = deriveFinanceOnboardingReadiness(snapshot);
  const dirty =
    displayReviewed !== snapshot.displayPreferences.reviewed ||
    choice !== snapshot.automationChoice ||
    snapshot.questions.some((q) => answers[q.questionId] !== q.disposition);
  const mutation = useMutation({
    mutationFn: async (operation: "save" | "complete") => {
      if (!choice) throw new Error("Choose when to set up automation.");
      const id = toast.loading(operation === "save" ? "Saving setup review…" : "Finishing setup…");
      try {
        const common = {
          expectedRevision: snapshot.revision,
          idempotencyKey: crypto.randomUUID(),
          automationChoice: choice,
        };
        const next =
          operation === "complete"
            ? await adapter.completeFinanceOnboarding(common)
            : await adapter.saveFinanceOnboardingAnswers({
                ...common,
                displayPreferencesReviewed: displayReviewed,
                answers: snapshot.questions.flatMap((q) => {
                  const disposition = answers[q.questionId];
                  return disposition && disposition !== "unreviewed"
                    ? [{ questionId: q.questionId, disposition }]
                    : [];
                }),
              });
        toast.success(
          operation === "save"
            ? "Setup review saved"
            : next.completedAt
              ? "Setup complete"
              : "Setup is still pending",
          { id },
        );
        return next;
      } catch (error) {
        setMustReload(true);
        toast.error(
          "Setup outcome unconfirmed. Your edits are still here. Reload the review before trying again.",
          { id },
        );
        throw error;
      }
    },
    onSuccess: (next) => {
      setSnapshot(next);
      setAnswers(Object.fromEntries(next.questions.map((q) => [q.questionId, q.disposition])));
      setDisplayReviewed(next.displayPreferences.reviewed);
      setChoice(next.automationChoice);
      onSnapshot(next);
    },
  });
  const locked = mutation.isPending || reloading || snapshot.completedAt !== null;
  return (
    <section aria-label="Setup review" className="grid gap-4 rounded-lg bg-card p-4">
      <div>
        <h2 className="font-medium">Review your setup</h2>
        <p className="text-sm text-muted-foreground">
          Use your saved financial context, including anything you do not know yet. Edit financial
          values in the profile below.
        </p>
      </div>
      <p>{snapshot.source.summary}</p>
      {snapshot.questions.map((question) => (
        <label
          key={question.questionId}
          htmlFor={`${controlId}-${question.questionId}`}
          className="grid gap-1"
        >
          <span>{question.label}</span>
          {question.answerSummary ? (
            <span className="text-sm text-muted-foreground">{question.answerSummary}</span>
          ) : null}
          <NativeSelect
            id={`${controlId}-${question.questionId}`}
            aria-label={question.label}
            value={answers[question.questionId]}
            disabled={locked}
            onChange={(event) =>
              setAnswers({
                ...answers,
                [question.questionId]: event.target.value as FinanceOnboardingDisposition,
              })
            }
          >
            <option value="unreviewed">Choose an answer</option>
            {question.answerSummary || question.disposition === "answered" ? (
              <option value="answered">Use saved answer</option>
            ) : null}
            {question.allowsNone ? <option value="none">None</option> : null}
            <option value="unknown">I don’t know yet</option>
          </NativeSelect>
        </label>
      ))}
      <div>
        <h3 className="font-medium">Display preferences</h3>
        {snapshot.displayPreferences.summary.map((item) => (
          <p key={item} className="text-sm text-muted-foreground">
            {item}
          </p>
        ))}
        <label htmlFor={`${controlId}-display`} className="flex items-center gap-2">
          <Checkbox
            id={`${controlId}-display`}
            checked={displayReviewed}
            disabled={locked}
            onCheckedChange={(checked) => setDisplayReviewed(checked === true)}
          />
          I reviewed my display preferences
        </label>
      </div>
      {snapshot.automationChoice === null && snapshot.completedAt === null ? (
        <div className="grid gap-2">
          <h3 className="font-medium">How would you like to use Finance?</h3>
          <ChoiceCardGroup
            aria-label="Initial Finance mode"
            value={choice ?? ""}
            disabled={locked}
            onValueChange={(value) => setChoice(value as "later" | "now")}
            options={[
              {
                value: "later",
                label: "Use Finance manually",
                preview: "Review your records yourself. Connect an agent later.",
              },
              {
                value: "now",
                label: "Set up with an agent",
                preview: "Get initial guidance, connect a host, and choose its cadence.",
              },
            ]}
          />
          <p className="text-sm text-muted-foreground">
            Your mode choice is saved with Save review.
          </p>
        </div>
      ) : (
        <label htmlFor={`${controlId}-automation`} className="grid gap-1">
          Automation
          <NativeSelect
            id={`${controlId}-automation`}
            aria-label="Automation"
            value={choice ?? ""}
            disabled={locked}
            onChange={(event) => setChoice(event.target.value as "later" | "now")}
          >
            <option value="" disabled>
              Choose when
            </option>
            <option value="later">Later — use Finance manually</option>
            <option value="now">Set up automation now</option>
          </NativeSelect>
        </label>
      )}
      {choice === "now" && snapshot.completedAt === null ? <FinanceSetupAgentGuidance /> : null}
      {snapshot.completedAt ? (
        <div className="grid gap-2">
          <p role="status">Setup complete. Your workspace remains available.</p>
          {continueTo ? (
            <Button asChild>
              <a href={continueTo}>Continue</a>
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          {readiness.blockers.length ? (
            <ul className="text-sm text-muted-foreground">
              {readiness.blockers.map((blocker) => (
                <li key={blocker}>{blockerCopy[blocker]}</li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={locked || mustReload || !choice || !dirty}
              onClick={() => mutation.mutate("save")}
            >
              Save review
            </Button>
            <Button
              disabled={locked || mustReload || dirty || !readiness.canComplete}
              onClick={() => mutation.mutate("complete")}
            >
              Finish setup
            </Button>
          </div>
        </>
      )}
      <div className="grid gap-2">
        <p className="text-sm text-muted-foreground">
          After editing your profile, reload this review to use the latest saved values. Reloading
          replaces any unsaved review choices.
        </p>
        <Button
          variant="secondary"
          disabled={mutation.isPending || reloading}
          onClick={() => void onReload()}
        >
          Reload setup review
        </Button>
      </div>
      {!readiness.chat.canSend ? (
        <p className="text-sm text-muted-foreground">
          {readiness.chat.reason === "verification_required"
            ? "Chat sending will be available after agent verification."
            : "Chat sending is currently unavailable."}
          {readiness.chat.historyReadable ? " Your existing Chat history remains available." : ""}
        </p>
      ) : null}
    </section>
  );
}
