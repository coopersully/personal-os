import type { FinanceCategory, FinanceTransactionQuery } from "@personal-os/domain";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { EnumChoice } from "../../components/forms/enum-choice";
import { Action, Actions, Group } from "../../components/forms/form-rows";
import { Icon } from "../../components/icons";
import { SettingsAccentProvider } from "../../components/settings-accent";
import { SheetHeader } from "../../components/sheet-header";
import { spacing, useTheme } from "../../theme";
import { categoryLabel } from "./category-presentation";
import { ReadState } from "./ui";

export interface TransactionView {
  categoryId: string | null;
  review: FinanceTransactionQuery["review"];
  sortBy: FinanceTransactionQuery["sortBy"];
  sortDirection: FinanceTransactionQuery["sortDirection"];
}
export const defaultTransactionView: TransactionView = {
  categoryId: null,
  review: "all",
  sortBy: "date",
  sortDirection: "desc",
};

const reviewOptions = [
  { value: "all", label: "Any review state" },
  { value: "needs_review", label: "Needs review" },
  { value: "resolved", label: "Reviewed" },
] as const;
const sortOptions = [
  { value: "date", label: "Date" },
  { value: "amount", label: "Amount" },
  { value: "merchant", label: "Merchant" },
] as const;
const orderLabels: Record<TransactionView["sortBy"], Record<"asc" | "desc", string>> = {
  date: { desc: "Newest first", asc: "Oldest first" },
  amount: { desc: "Highest first", asc: "Lowest first" },
  merchant: { asc: "A to Z", desc: "Z to A" },
};
/** The order a person expects when first sorting by a field. */
const naturalOrder: Record<TransactionView["sortBy"], "asc" | "desc"> = {
  date: "desc",
  amount: "desc",
  merchant: "asc",
};

export function reviewLabel(review: TransactionView["review"]) {
  return reviewOptions.find((option) => option.value === review)?.label ?? "Any review state";
}
/** "Amount, highest first": the effective order in a person's words. */
export function sortSummary(view: TransactionView) {
  const field = sortOptions.find((option) => option.value === view.sortBy)?.label ?? "Date";
  return `${field}, ${orderLabels[view.sortBy][view.sortDirection].toLowerCase()}`;
}
/** Only what differs from the default is sent, so an untouched list keeps its original request. */
export function transactionViewQuery(view: TransactionView, withCategory: boolean) {
  const sorted = view.sortBy !== "date" || view.sortDirection !== "desc";
  return {
    categoryId: withCategory ? (view.categoryId ?? undefined) : undefined,
    review: view.review === "all" ? undefined : view.review,
    sortBy: sorted ? view.sortBy : undefined,
    sortDirection: sorted ? view.sortDirection : undefined,
  };
}

/** A removable active filter: the whole chip removes it, and says so to a screen reader. */
export function ActiveFilter({ label, onRemove }: { label: string; onRemove: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Remove filter ${label}`}
      onPress={onRemove}
      style={{
        minHeight: 44,
        borderRadius: 22,
        paddingHorizontal: 14,
        backgroundColor: t.surface,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
      }}
    >
      <Text numberOfLines={1} style={{ color: t.ink, maxWidth: 230, fontSize: 14 }}>
        {label}
      </Text>
      <Icon name="cancel" size={14} color={t.secondary} />
    </Pressable>
  );
}

/** Matching filters and presentation order for a transaction list; changes apply at once. */
export function TransactionFilters({
  view,
  categories,
  withCategory,
  onChange,
  onClose,
}: {
  view: TransactionView;
  categories: Parameters<typeof ReadState>[0]["query"] & { data: FinanceCategory[] | undefined };
  /** A list already scoped to one budget category does not offer a second category filter. */
  withCategory: boolean;
  onChange: (view: TransactionView) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const filtered = view.review !== "all" || (withCategory && view.categoryId !== null);
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View accessibilityViewIsModal style={{ flex: 1, backgroundColor: t.canvas }}>
        <SheetHeader title="filters" label="Done" dismiss="trailing" onClose={onClose} />
        <SettingsAccentProvider workspace="finances">
          <ScrollView
            contentContainerStyle={{
              gap: spacing.lg,
              paddingHorizontal: spacing.page,
              paddingBottom: Math.max(insets.bottom, spacing.page),
            }}
          >
            <Group>
              {withCategory && (
                <ReadState query={categories}>
                  <EnumChoice
                    label="Category"
                    icon="grid"
                    value={view.categoryId ?? "all"}
                    options={[
                      { value: "all", label: "All categories" },
                      ...(categories.data ?? []).map((item) => ({
                        value: item.id,
                        label: categoryLabel(item.name),
                      })),
                    ]}
                    onChange={(value) =>
                      onChange({ ...view, categoryId: value === "all" ? null : value })
                    }
                  />
                </ReadState>
              )}
              <EnumChoice
                label="Review"
                icon="attention"
                value={view.review}
                options={reviewOptions}
                onChange={(value) =>
                  onChange({ ...view, review: value as TransactionView["review"] })
                }
              />
            </Group>
            <Group>
              <EnumChoice
                label="Sort by"
                value={view.sortBy}
                options={sortOptions}
                onChange={(value) => {
                  const sortBy = value as TransactionView["sortBy"];
                  onChange({ ...view, sortBy, sortDirection: naturalOrder[sortBy] });
                }}
              />
              <EnumChoice
                label="Order"
                value={view.sortDirection}
                options={(["desc", "asc"] as const).map((direction) => ({
                  value: direction,
                  label: orderLabels[view.sortBy][direction],
                }))}
                onChange={(value) =>
                  onChange({ ...view, sortDirection: value as TransactionView["sortDirection"] })
                }
              />
            </Group>
            <Actions inset={false}>
              <Action
                label="Reset filters"
                disabled={!filtered}
                onPress={() => onChange({ ...view, categoryId: null, review: "all" })}
              />
            </Actions>
          </ScrollView>
        </SettingsAccentProvider>
      </View>
    </Modal>
  );
}
