import type { FinanceReviewCase, FinanceTransaction } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { toast } from "sonner-native";
import { EntityPicker } from "../../components/forms/entity-picker";
import { Icon } from "../../components/icons";
import { spacing, useTheme } from "../../theme";
import { categoryIcon, categoryLabel } from "./category-presentation";
import { useFinance, useFinanceRead } from "./data";
import { confirmChoice } from "./goal-confirm";
import { appliedTransaction } from "./mutations";
import { activeAllocations } from "./splits";
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
  const parts = activeAllocations(item).length;
  const split = parts > 1;
  // Approving a split under review keeps its parts; only a chosen category replaces them.
  const canApprove =
    !!review &&
    (split || !!(item.categoryId ?? review.suggestedCategory?.id)) &&
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
        toast.success(split && !categoryId ? "Splits approved" : "Category updated", {
          id: toastId,
        });
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
  // Split across categories and not awaiting review: the parts are the categorization.
  if (parts > 1 && !review)
    return (
      <FinanceRow
        centered
        title="Category"
        value={`Split in ${parts} parts`}
        icon="categoryLayers"
        accessibilityHint="Edit splits"
        onPress={
          item.pending
            ? undefined
            : () =>
                router.push({
                  pathname: "/finance-transaction-edit",
                  params: { id: item.id, field: "splits" },
                })
        }
      />
    );
  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <FinanceRow
            centered
            title="Category"
            value={split ? `Split in ${parts} parts` : categoryLabel(suggested)}
            icon={split ? "categoryLayers" : categoryIcon(item.category ?? "Uncategorized")}
            valueTone={needsInput ? "attention" : undefined}
            accessibilityHint={
              split
                ? "Needs your input. Approve the splits or replace them with one category."
                : needsInput
                  ? "Needs your input. Choose or approve a category."
                  : "Change category"
            }
            onPress={pending ? undefined : () => setChoosing(true)}
          />
        </View>
        {canApprove && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={split ? "Approve splits" : "Approve category"}
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
              label: categoryLabel(entry.name),
              icon: categoryIcon(entry.name),
              value: entry.id,
            }))}
            onChange={(value) => {
              if (!value) return;
              if (!split) return void save(value);
              // A review resolved with one category replaces every part; say so first.
              const name = categories.data?.find((entry) => entry.id === value)?.name;
              confirmChoice({
                title: `Replace ${parts} parts?`,
                message: `Choosing ${categoryLabel(name)} puts the whole transaction in that category and removes its ${parts} parts.`,
                cancel: "Keep splits",
                accept: "Replace parts",
                destructive: true,
                onAccept: () => void save(value),
              });
            }}
            onClose={() => setChoosing(false)}
          />
        </ReadState>
      )}
    </>
  );
}
