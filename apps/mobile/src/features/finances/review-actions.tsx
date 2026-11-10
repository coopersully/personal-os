import type { FinanceReviewCase } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { toast } from "sonner-native";
import { Icon } from "../../components/icons";
import { RowActions } from "../../components/row-actions";
import { useTheme, workspaceColor } from "../../theme";
import { useFinance } from "./data";

export function ReviewActions({ review }: { review: FinanceReviewCase }) {
  const t = useTheme();
  const { api, owner } = useFinance();
  const client = useQueryClient();
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const active = useRef(owner);
  useEffect(() => {
    active.current = owner;
    return () => {
      active.current = undefined;
    };
  }, [owner]);
  const decide = async (action: "approve" | "defer") => {
    if (!owner || busy.current) return;
    busy.current = true;
    setPending(true);
    const id = toast.loading("Updating review…");
    try {
      const result = await api.resolveFinanceReview(review.id, {
        action,
        expectedTransactionUpdatedAt: review.transaction.updatedAt,
        learnMerchant: "never",
        rationale: null,
      });
      if (active.current !== owner) {
        toast.dismiss(id);
        return;
      }
      if ("deferred" in result) toast.success("Review deferred", { id });
      else if (result.applied) toast.success("Review completed", { id });
      else toast.info("This transaction still needs review", { id });
      void client.invalidateQueries({ queryKey: ["finances", owner] });
    } catch {
      if (active.current === owner)
        toast.error("Couldn’t confirm the change. Refresh the review before trying again.", { id });
      else toast.dismiss(id);
      void client.invalidateQueries({ queryKey: ["finances", owner, "reviews"] });
    } finally {
      busy.current = false;
      if (active.current === owner) setPending(false);
    }
  };
  const canApprove =
    !!(review.transaction.categoryId ?? review.suggestedCategory?.id) &&
    review.transaction.direction !== "transfer" &&
    review.reason !== "possible_transfer";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      {canApprove && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Approve category"
          disabled={pending}
          onPress={() => void decide("approve")}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            minHeight: 44,
            opacity: pending ? 0.5 : 1,
          }}
        >
          <Icon name="save" size={20} color={workspaceColor(t, "finances")} />
          <Text style={{ color: workspaceColor(t, "finances"), fontWeight: "600" }}>Approve</Text>
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Change category"
        disabled={pending}
        onPress={() =>
          router.push({
            pathname: "/finance-transaction-edit",
            params: { id: review.transaction.id, field: "category" },
          })
        }
        style={{ flex: 1, minHeight: 44, justifyContent: "center" }}
      >
        <Text style={{ color: t.ink, fontWeight: "600" }}>
          {canApprove ? "Change" : "Choose category"}
        </Text>
      </Pressable>
      <RowActions
        label={`Actions for ${review.transaction.merchant}`}
        actions={[
          {
            id: "defer",
            label: "Review later",
            icon: "clock",
            disabled: pending,
            onPress: () => void decide("defer"),
          },
        ]}
      />
    </View>
  );
}
