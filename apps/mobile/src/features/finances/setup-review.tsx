import {
  deriveFinanceOnboardingReadiness,
  type FinanceOnboardingBlocker,
  type FinanceOnboardingDisposition,
  type FinanceOnboardingSnapshot,
} from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner-native";
import { EnumChoice } from "../../components/forms/enum-choice";
import { Action, Actions, Group, SectionNote, ToggleRow } from "../../components/forms/form-rows";
import { SettingsAccentProvider } from "../../components/settings-accent";
import { useCurrentSession } from "./budget-write";
import { useFinance, useFinanceRead } from "./data";
import { confirmedRejection, rejectionReason } from "./mutations";
import { Card, Copy, FinanceRow, ReadState, Section } from "./ui";

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
const automationOptions = [
  { value: "later", label: "Later — use Finance manually" },
  { value: "now", label: "Set up automation now" },
] as const;

type Answers = Record<string, FinanceOnboardingDisposition>;
const dispositions = (snapshot: FinanceOnboardingSnapshot): Answers =>
  Object.fromEntries(
    snapshot.questions.map((question) => [question.questionId, question.disposition]),
  );

/**
 * One key per distinct request, per person. A request whose outcome is unknown keeps its key, so
 * sending the same draft against the same revision again cannot be applied twice.
 */
const requestKeys = new Map<string, string>();

/** The server's onboarding snapshot. Only its `completedAt` says setup is complete. */
export function useFinanceOnboarding() {
  return useFinanceRead(["onboarding"], (api) => api.getFinanceOnboarding());
}

/** The onboarding review, once the server's snapshot has been read. */
export function SetupReview() {
  const query = useFinanceOnboarding();
  return (
    <Section title="Review your setup">
      {query.data ? (
        <Review initial={query.data} refetch={query.refetch} />
      ) : (
        <ReadState query={query}>{null}</ReadState>
      )}
    </Section>
  );
}

function Review({
  initial,
  refetch,
}: {
  initial: FinanceOnboardingSnapshot;
  refetch: ReturnType<typeof useFinanceOnboarding>["refetch"];
}) {
  const { api, owner } = useFinance();
  const client = useQueryClient();
  const current = useCurrentSession();
  // The review is pinned to the snapshot it was drafted against. A background refetch never
  // replaces a draft; only a confirmed write or an explicit reload does.
  const [snapshot, setSnapshot] = useState(initial);
  const [answers, setAnswers] = useState(() => dispositions(initial));
  const [displayReviewed, setDisplayReviewed] = useState(initial.displayPreferences.reviewed);
  const [choice, setChoice] = useState(initial.automationChoice);
  const [mustReload, setMustReload] = useState(false);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  const readiness = deriveFinanceOnboardingReadiness(snapshot);
  const complete = snapshot.completedAt !== null;
  const dirty =
    displayReviewed !== snapshot.displayPreferences.reviewed ||
    choice !== snapshot.automationChoice ||
    snapshot.questions.some((question) => answers[question.questionId] !== question.disposition);
  const locked = pending || complete;

  function adopt(next: FinanceOnboardingSnapshot) {
    setSnapshot(next);
    setAnswers(dispositions(next));
    setDisplayReviewed(next.displayPreferences.reviewed);
    setChoice(next.automationChoice);
  }
  // A newer server snapshot (say, after registering an automation) refreshes a review that has
  // no unsaved choices. It never replaces a draft, and never lifts the reload lock.
  const untouched = useRef(true);
  untouched.current = !dirty && !pending && !mustReload;
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new snapshot is adopted.
  useEffect(() => {
    // Revisions only advance, so an older read that lands late is not a newer snapshot.
    if (untouched.current && initial !== snapshot && initial.revision >= snapshot.revision)
      adopt(initial);
  }, [initial]);
  /** Replaces the draft with what the server holds now. False when that could not be read. */
  async function readAgain() {
    const result = await refetch();
    if (!current() || result.isError || !result.data) return false;
    adopt(result.data);
    setMustReload(false);
    return true;
  }
  async function reload() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    const id = toast.loading("Reloading setup review…");
    try {
      const reloaded = await readAgain();
      if (!current()) return void toast.dismiss(id);
      if (reloaded) toast.success("Setup review reloaded", { id });
      else toast.error("Couldn’t reload the setup review. Your choices are still here.", { id });
    } finally {
      busy.current = false;
      if (current()) setPending(false);
    }
  }
  async function write(operation: "save" | "complete") {
    if (busy.current || !choice || mustReload) return;
    busy.current = true;
    setPending(true);
    const reviewed = snapshot.questions.flatMap((question) => {
      const disposition = answers[question.questionId];
      return disposition && disposition !== "unreviewed"
        ? [{ questionId: question.questionId, disposition }]
        : [];
    });
    const slot = `${owner}:${JSON.stringify(
      operation === "save"
        ? [operation, snapshot.revision, choice, displayReviewed, reviewed]
        : [operation, snapshot.revision, choice],
    )}`;
    const idempotencyKey = requestKeys.get(slot) ?? randomUUID();
    requestKeys.set(slot, idempotencyKey);
    const common = {
      expectedRevision: snapshot.revision,
      idempotencyKey,
      automationChoice: choice,
    };
    const id = toast.loading(operation === "save" ? "Saving setup review…" : "Finishing setup…");
    try {
      const next =
        operation === "save"
          ? await api.saveFinanceOnboardingAnswers({
              ...common,
              displayPreferencesReviewed: displayReviewed,
              answers: reviewed,
            })
          : await api.completeFinanceOnboarding(common);
      requestKeys.delete(slot);
      if (!current()) return void toast.dismiss(id);
      adopt(next);
      client.setQueryData(["finances", owner, "onboarding"], next);
      if (operation === "save") toast.success("Setup review saved", { id });
      // Only the server's completion timestamp is completion.
      else if (next.completedAt) toast.success("Finance setup finished", { id });
      else toast.info("Setup is still pending", { id });
    } catch (error) {
      const rejected = confirmedRejection(error);
      if (rejected) requestKeys.delete(slot);
      if (!current()) return void toast.dismiss(id);
      if (rejected && error.status === 409) {
        const reloaded = await readAgain();
        if (!current()) return void toast.dismiss(id);
        if (!reloaded) setMustReload(true);
        toast.error(
          reloaded
            ? "This review changed elsewhere. Nothing was saved; the latest review is shown."
            : "This review changed elsewhere and couldn’t be reloaded. Reload the review before trying again.",
          { id },
        );
      } else if (rejected) {
        toast.error(
          `${operation === "save" ? "Setup review not saved." : "Setup not finished."}${rejectionReason(error)}`,
          { id },
        );
      } else {
        // The write may have landed. Nothing more is sent until the server's state is read.
        setMustReload(true);
        toast.error(
          operation === "save"
            ? "Couldn’t confirm the setup review was saved. Reload the review before trying again."
            : "Couldn’t confirm setup finished. Reload the review before trying again.",
          { id },
        );
      }
    } finally {
      busy.current = false;
      if (current()) setPending(false);
    }
  }

  return (
    <SettingsAccentProvider workspace="finances">
      <Copy secondary>
        Use your saved financial context, including anything you do not know yet.
      </Copy>
      <Copy>{snapshot.source.summary}</Copy>
      {snapshot.questions.map((question) => {
        const answerable = question.answerSummary !== null || question.disposition === "answered";
        return (
          <Group key={question.questionId}>
            <EnumChoice
              label={question.label}
              icon="info"
              value={answers[question.questionId] ?? "unreviewed"}
              valueLabel={
                (answers[question.questionId] ?? "unreviewed") === "unreviewed"
                  ? "Choose an answer"
                  : undefined
              }
              disabled={locked}
              options={[
                ...(answerable ? [{ value: "answered", label: "Answered" }] : []),
                ...(question.allowsNone ? [{ value: "none", label: "None" }] : []),
                { value: "unknown", label: "Not sure" },
              ]}
              onChange={(disposition) =>
                setAnswers({
                  ...answers,
                  [question.questionId]: disposition as FinanceOnboardingDisposition,
                })
              }
            />
            {question.answerSummary !== null && (
              <SectionNote>{`Saved answer: ${question.answerSummary}`}</SectionNote>
            )}
          </Group>
        );
      })}
      <Section title="Display preferences">
        {snapshot.displayPreferences.summary.map((item) => (
          <Copy key={item} secondary>
            {item}
          </Copy>
        ))}
        <Group>
          <ToggleRow
            label="I reviewed my display preferences"
            value={displayReviewed}
            disabled={locked}
            onChange={setDisplayReviewed}
          />
        </Group>
      </Section>
      <Section title="Automation">
        <Group>
          <EnumChoice
            label="Automation"
            icon="agent"
            value={choice}
            valueLabel={choice ? undefined : "Choose when"}
            disabled={locked}
            options={automationOptions}
            onChange={(next) => setChoice(next as "later" | "now")}
          />
        </Group>
      </Section>
      {choice === "now" && !complete && (
        <Card rows>
          <FinanceRow
            title="Finance automations"
            subtitle="Register a host and the schedule you expect it to keep"
            icon="agent"
            onPress={() => router.push("/finance-automations")}
          />
        </Card>
      )}
      {complete ? (
        <Copy>Setup is complete. Your workspace remains available.</Copy>
      ) : (
        <>
          {readiness.blockers.map((blocker) => (
            <Copy key={blocker} secondary>
              {blockerCopy[blocker]}
            </Copy>
          ))}
          <Actions inset={false}>
            <Action
              label="Save review"
              disabled={locked || mustReload || !choice || !dirty}
              onPress={() => void write("save")}
            />
            <Action
              label="Finish setup"
              disabled={locked || mustReload || dirty || !readiness.canComplete}
              onPress={() => void write("complete")}
            />
          </Actions>
        </>
      )}
      <Copy secondary>
        Reload this review to use the latest saved values. Reloading replaces any unsaved review
        choices.
      </Copy>
      <Actions inset={false}>
        <Action label="Reload setup review" disabled={pending} onPress={() => void reload()} />
      </Actions>
    </SettingsAccentProvider>
  );
}
