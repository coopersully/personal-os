import {
  deriveFinanceOnboardingReadiness,
  type FinanceOnboardingAdapter,
  type FinanceOnboardingBlocker,
  type FinanceOnboardingDisposition,
  type FinanceOnboardingSnapshot,
} from "@personal-os/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect } from "@/components/ui/native-select";

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
export function FinanceOnboardingReview({ adapter }: { adapter: FinanceOnboardingAdapter }) {
  const client = useQueryClient();
  const [reload, setReload] = useState(0);
  const query = useQuery({
    queryKey: ["finance-onboarding", adapter],
    queryFn: () => adapter.getFinanceOnboarding(),
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  if (query.isPending) return <p role="status">Loading setup review…</p>;
  if (query.isError && !query.data)
    return (
      <div role="alert">
        Setup review could not load.{" "}
        <Button onClick={() => void query.refetch()}>Retry setup review</Button>
      </div>
    );
  return (
    <ReviewSnapshot
      key={`${query.data.revision}:${reload}`}
      adapter={adapter}
      snapshot={query.data}
      onSnapshot={(next) => client.setQueryData(["finance-onboarding", adapter], next)}
      reloading={query.isFetching}
      onReload={async () => {
        const id = toast.loading("Reloading setup review…");
        const result = await query.refetch();
        if (result.isError)
          toast.error("Setup review could not reload. Your edits are still here.", { id });
        else {
          toast.success("Setup review reloaded", { id });
          setReload((value) => value + 1);
        }
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
}: {
  adapter: FinanceOnboardingAdapter;
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
  const locked = mutation.isPending || snapshot.completedAt !== null;
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
      {snapshot.completedAt ? (
        <p role="status">Setup complete. Your workspace remains available.</p>
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
      {mustReload ? (
        <Button variant="secondary" disabled={reloading} onClick={() => void onReload()}>
          Reload setup review
        </Button>
      ) : null}
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
