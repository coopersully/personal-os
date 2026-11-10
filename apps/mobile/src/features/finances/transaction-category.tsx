import type { FinanceReviewCase, FinanceTransaction } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { toast } from "sonner-native";
import { EntityPicker } from "../../components/forms/entity-picker";
import { Icon } from "../../components/icons";
import { spacing, useTheme } from "../../theme";
import { categoryIcon } from "./category-presentation";
import { useFinance, useFinanceRead } from "./data";
import { appliedTransaction } from "./mutations";
import { FinanceRow, ReadState } from "./ui";

/** Attention belongs to the editable field, and clears only on a confirmed server receipt. */
export function TransactionCategory({
  item,
  review,
}: {
  item: FinanceTransaction;
  review?: FinanceReviewCase;
}) {
  const t = useTheme();
  const { api, owner } = useFinance();
  const client = useQueryClient();
  const [choosing, setChoosing] = useState(false);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const active = useRef(owner);
  useEffect(() => {
    active.current = owner;
    return () => {
      active.current = undefined;
    };
  }, [owner]);
  const categories = useFinanceRead(["categories"], (api) => api.getFinanceCategories(), choosing);
  const needsInput = !item.category || !!review;
  const suggested = item.category ?? review?.suggestedCategory?.name;
  const canApprove =
    !!review &&
    !!(item.categoryId ?? review.suggestedCategory?.id) &&
    item.direction !== "transfer" &&
    review.reason !== "possible_transfer";
  async function save(categoryId?: string) {
    if (!owner || busy.current) return;
    const category = categories.data?.find((entry) => entry.id === categoryId);
    if (categoryId && !category) return;
    if (!categoryId && !canApprove) return;
    busy.current = true;
    setPending(true);
    const toastId = toast.loading("Saving category…");
    try {
      let saved: FinanceTransaction | null;
      if (review) {
        const result = await api.resolveFinanceReview(review.id, {
          action: categoryId ? "recategorize" : "approve",
          ...(categoryId ? { categoryId } : {}),
          ...(review.reason === "possible_transfer" && item.direction !== "transfer"
            ? { nonTransferDirection: item.direction }
            : {}),
          expectedTransactionUpdatedAt: item.updatedAt,
          learnMerchant: "never",
          rationale: null,
        });
        saved = "applied" in result && result.applied ? result.transaction : null;
      } else {
        if (!category) return;
        saved = appliedTransaction<FinanceTransaction>(
          await api.updateFinanceTransaction(item.id, {
            category: category.name,
            expectedTransactionUpdatedAt: item.updatedAt,
          }),
        );
      }
      if (active.current !== owner) {
        toast.dismiss(toastId);
        return;
      }
      if (saved) {
        client.setQueryData(["finances", owner, "transaction", item.id], { data: saved });
        if (review)
          client.setQueryData<FinanceReviewCase[]>(["finances", owner, "reviews"], (rows) =>
            rows?.filter((entry) => entry.id !== review.id),
          );
        toast.success("Category updated", { id: toastId });
      } else toast.info("This transaction still needs review", { id: toastId });
      void client.invalidateQueries({ queryKey: ["finances", owner] });
    } catch {
      if (active.current === owner) {
        toast.error(
          "Couldn’t confirm the category. Refreshing the transaction before you try again.",
          { id: toastId },
        );
        void client.invalidateQueries({ queryKey: ["finances", owner] });
      } else toast.dismiss(toastId);
    } finally {
      busy.current = false;
      if (active.current === owner) setPending(false);
    }
  }
  const color = needsInput ? t.warning : t.ink;
  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <FinanceRow
            centered
            title="Category"
            value={suggested ?? "Uncategorized"}
            icon={categoryIcon(item.category ?? "Uncategorized")}
            valueTone={needsInput ? "attention" : undefined}
            accessibilityHint={
              needsInput ? "Needs your input. Choose or approve a category." : "Change category"
            }
            onPress={pending ? undefined : () => setChoosing(true)}
          />
        </View>
        {canApprove && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Approve category"
            disabled={pending}
            onPress={() => void save()}
            style={{
              minWidth: 44,
              minHeight: 44,
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <Icon name="save" color={color} size={24} />
          </Pressable>
        )}
      </View>
      {choosing && (
        <ReadState query={categories}>
          <EntityPicker
            title="Categories"
            icon="grid"
            value={item.categoryId ?? null}
            options={(categories.data ?? []).map((entry) => ({
              label: entry.name,
              icon: categoryIcon(entry.name),
              value: entry.id,
            }))}
            onChange={(value) => {
              if (value) void save(value);
            }}
            onClose={() => setChoosing(false)}
          />
        </ReadState>
      )}
    </>
  );
}
