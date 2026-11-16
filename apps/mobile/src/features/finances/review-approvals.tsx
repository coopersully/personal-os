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
            waiting.map((review) => <ActionReviewCard key={review.id} review={review} />)
          ) : (
            <Copy secondary>No changes waiting for your approval.</Copy>
          )}
        </View>
      </ReadState>
    </Section>
  );
}

function ActionReviewCard({ review }: { review: FinanceActionReview }) {
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

  async function decide(action: "approve" | "dismiss") {
    if (!owner || busy.current || unconfirmed) return;
    busy.current = true;
    setPending(true);
    const approving = action === "approve";
    const id = toast.loading(approving ? "Approving…" : "Dismissing…");
    const reviews = ["finances", owner, "action-reviews"];
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
        setUnconfirmed(true);
        toast.error(
          `Couldn’t confirm the ${approving ? "approval" : "dismissal"}. Checking the latest state before you try again.`,
          { id },
        );
        await client.refetchQueries({ queryKey: reviews });
        // Only a read that succeeded shows whether the decision landed.
        if (active.current && client.getQueryState(reviews)?.status === "success")
          setUnconfirmed(false);
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
        {review.changes.slice(0, shownChanges).map((change, index) => (
          // Summaries are free text and may repeat; their order is the stable identity.
          // biome-ignore lint/suspicious/noArrayIndexKey: the list is never reordered
          <Copy key={index}>{change.summary}</Copy>
        ))}
        {more > 0 && <Copy secondary>{`And ${more} more.`}</Copy>}
      </View>
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
