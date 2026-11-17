import { ApiClientError } from "@personal-os/api-client";
import type { FinanceActionReview } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { toast } from "sonner-native";
import { Action, Actions } from "../../components/forms/form-rows";
import { SettingsAccentProvider } from "../../components/settings-accent";
import { useFinance, useFinanceRead } from "./data";
import { confirmedRejection } from "./mutations";
import { financeLabel } from "./presentation";
import { Card, Copy, ReadState, Section } from "./ui";

const shownChanges = 5;
const reviewTitle = (review: FinanceActionReview) =>
  review.actionKind === "maintenance_turn"
    ? "Maintained finances"
    : financeLabel(review.actionKind);

/** Changes an agent prepared that wait for the person's approval, decided outside chat. */
export function ActionReviews() {
  // The list holds every status, newest first; the API's largest page keeps an older
  // pending review from falling behind newer applied and dismissed ones.
  const query = useFinanceRead(["action-reviews"], (api) => api.listFinanceActionReviews(200));
  const waiting = (query.data ?? []).filter((review) => review.status === "pending");
  return (
    <Section title="Approvals">
      <ReadState query={query}>
        <View style={{ gap: 12 }}>
          {waiting.length ? (
            waiting.map((review) => (
              <ActionReviewCard key={review.id} review={review} readAt={query.dataUpdatedAt} />
            ))
          ) : (
            <Copy secondary>No changes waiting for your approval.</Copy>
          )}
        </View>
      </ReadState>
    </Section>
  );
}

function ActionReviewCard({
  review,
  readAt,
}: {
  review: FinanceActionReview;
  /** When the reviews were last read successfully. */
  readAt: number;
}) {
  const { api, owner } = useFinance();
  const client = useQueryClient();
  const [pending, setPending] = useState(false);
  // After an outcome nobody confirmed, the card waits for a fresh read of the reviews.
  const [unconfirmed, setUnconfirmed] = useState(false);
  const busy = useRef(false);
  const active = useRef(true);
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const current = () => active.current && currentOwner.current === owner;
  const title = reviewTitle(review);
  const [showAll, setShowAll] = useState(false);
  const reviews = ["finances", owner, "action-reviews"];
  // How many reads had succeeded when the outcome was found unconfirmed. Only a read that
  // succeeds after that settles the doubt: the check below, or a Retry after it failed.
  const uncertainAfter = useRef<number | null>(null);
  const settle = () => {
    const reads = client.getQueryState(reviews)?.dataUpdateCount ?? 0;
    if (uncertainAfter.current !== null && reads > uncertainAfter.current) {
      uncertainAfter.current = null;
      setUnconfirmed(false);
    }
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: a newer successful read is the trigger.
  useEffect(settle, [readAt]);

  async function decide(action: "approve" | "dismiss") {
    if (!owner || busy.current || unconfirmed) return;
    busy.current = true;
    setPending(true);
    const approving = action === "approve";
    const id = toast.loading(approving ? "Approving…" : "Dismissing…");
    try {
      if (approving) {
        const outcome = await api.approveFinanceActionReview(review.id);
        if (!current()) return void toast.dismiss(id);
        if (outcome.status === "applied") toast.success("Approved and applied", { id });
        else if (outcome.status === "needs_input")
          toast.info(
            "Not applied. nohmi needs an answer from you before this change can go ahead.",
            { id },
          );
        else toast.info("Not applied. This change now needs a new review.", { id });
      } else {
        const result = await api.dismissFinanceActionReview(review.id);
        if (!current()) return void toast.dismiss(id);
        if (result.status === "dismissed") toast.success("Review dismissed", { id });
        else toast.info(`Nothing was dismissed. This review was already ${result.status}.`, { id });
      }
      void client.invalidateQueries({ queryKey: ["finances", owner] });
    } catch (error) {
      if (!current()) return void toast.dismiss(id);
      if (error instanceof ApiClientError && [404, 409].includes(error.status)) {
        toast.error(
          approving
            ? "Nothing was applied. This review changed or is no longer waiting for approval."
            : "Nothing was dismissed. This review is no longer available.",
          { id },
        );
        void client.invalidateQueries({ queryKey: reviews });
      } else if (confirmedRejection(error)) {
        toast.error(
          approving
            ? "Couldn’t approve this change. Nothing was applied."
            : "Couldn’t dismiss this review. Nothing was changed.",
          { id },
        );
        void client.invalidateQueries({ queryKey: reviews });
      } else {
        uncertainAfter.current = client.getQueryState(reviews)?.dataUpdateCount ?? 0;
        setUnconfirmed(true);
        toast.error(
          `Couldn’t confirm the ${approving ? "approval" : "dismissal"}. Checking the latest state before you try again.`,
          { id },
        );
        // Only a read that starts now and succeeds shows whether the decision landed; a read
        // already under way is cancelled and replaced, so it cannot release the card.
        void client.refetchQueries({ queryKey: reviews }).then(() => {
          if (current()) settle();
        });
      }
    } finally {
      busy.current = false;
      if (active.current) setPending(false);
    }
  }

  const locked = pending || unconfirmed;
  const more = review.changes.length - shownChanges;
  return (
    <Card>
      <Copy>{title}</Copy>
      <Copy secondary>{review.rationale}</Copy>
      <View style={{ gap: 4 }}>
        {review.changes.slice(0, showAll ? undefined : shownChanges).map((change, index) => (
          // Summaries are free text and may repeat; their order is the stable identity.
          // biome-ignore lint/suspicious/noArrayIndexKey: the list is never reordered
          <Copy key={index}>{change.summary}</Copy>
        ))}
      </View>
      {more > 0 && (
        // Approve applies every change, so every change can be read first.
        <SettingsAccentProvider workspace="finances">
          <Actions inset={false}>
            <Action
              label={
                showAll
                  ? "Show fewer changes"
                  : `Show ${more} more ${more === 1 ? "change" : "changes"}`
              }
              accessibilityLabel={`${showAll ? "Show fewer changes" : `Show ${more} more ${more === 1 ? "change" : "changes"}`} in ${title}`}
              onPress={() => setShowAll((value) => !value)}
            />
          </Actions>
        </SettingsAccentProvider>
      )}
      {review.assumptions.length > 0 && (
        <Copy secondary>{`Assumes: ${review.assumptions.join(" ")}`}</Copy>
      )}
      <SettingsAccentProvider workspace="finances">
        <Actions inset={false}>
          <Action
            label="Approve"
            accessibilityLabel={`Approve ${title}`}
            disabled={locked}
            onPress={() => void decide("approve")}
          />
          <Action
            label="Dismiss"
            accessibilityLabel={`Dismiss ${title}`}
            destructive
            disabled={locked}
            onPress={() => void decide("dismiss")}
          />
        </Actions>
      </SettingsAccentProvider>
    </Card>
  );
}
