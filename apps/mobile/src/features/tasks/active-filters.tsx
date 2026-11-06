import type { TaskWorkspaceQuery } from "@personal-os/domain";
import { Pressable, ScrollView, Text, View } from "react-native";
import { spacing, useTheme } from "../../theme";
import { useAuth } from "../auth/context";
import type { OptionsMenuProps } from "./options-menu";
import { activeFilters } from "./presentation";
import { Action } from "./ui";

const labels: Record<string, string> = {
  kind: "Type",
  status: "Status",
  priority: "Priority",
  due: "Due",
  reserved: "Reserved",
  sort: "Sort",
  group: "Group",
  tag: "Tag",
  dueAfter: "Due after",
  dueBefore: "Due before",
  scheduledAfter: "Reserved after",
  scheduledBefore: "Reserved before",
};
export function ActiveFilters({
  filters,
  choices,
  search,
  onRemove,
  onClearSearch,
  onClear,
}: {
  filters: Partial<TaskWorkspaceQuery>;
  choices: OptionsMenuProps["choices"];
  search: string;
  onRemove: (key: keyof TaskWorkspaceQuery) => void;
  onClearSearch: () => void;
  onClear: () => void;
}) {
  const t = useTheme();
  const { state } = useAuth();
  const chip = (key: string, label: string, remove: () => void) => (
    <Pressable
      key={key}
      accessibilityRole="button"
      accessibilityLabel={`Remove ${label}`}
      onPress={remove}
      style={{
        minHeight: 44,
        borderRadius: 22,
        paddingHorizontal: 14,
        backgroundColor: t.surface,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
      }}
    >
      <Text numberOfLines={1} style={{ color: t.ink, maxWidth: 230, fontSize: 14 }}>
        {label}
      </Text>
      <Text accessible={false} style={{ color: t.secondary, fontSize: 18 }}>
        ×
      </Text>
    </Pressable>
  );
  const entries = activeFilters(filters);
  if (!entries.length && !search.trim()) return null;
  return (
    <View style={{ marginBottom: spacing.sm }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: spacing.xs }}
      >
        {search.trim() ? chip("search", `Search: ${search}`, onClearSearch) : null}
        {entries.map(([key, value]) => {
          const choice = choices.find((item) => item.key === key);
          const display =
            choice?.options.find((option) => option.value === value)?.label ??
            (key.endsWith("After") || key.endsWith("Before")
              ? new Intl.DateTimeFormat(undefined, {
                  month: "short",
                  day: "numeric",
                  timeZone: state.user?.planningTimezone,
                }).format(new Date(String(value)))
              : String(value));
          return chip(key, `${choice?.label ?? labels[key] ?? key}: ${display}`, () =>
            onRemove(key as keyof TaskWorkspaceQuery),
          );
        })}
        <Action label="Clear all" onPress={onClear} />
      </ScrollView>
    </View>
  );
}
