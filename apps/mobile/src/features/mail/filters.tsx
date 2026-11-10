import { Pressable, Text, View } from "react-native";
import { FilterChip } from "../../components/filter-chip";
import { spacing, useTheme, workspaceColor } from "../../theme";
export type MailFilterValue = { unread?: true; starred?: true };
export function MailFilters({
  value,
  onChange,
}: {
  value: MailFilterValue;
  onChange: (value: MailFilterValue) => void;
}) {
  const t = useTheme();
  const color = workspaceColor(t, "mail");
  return (
    <View
      style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, paddingTop: spacing.md }}
    >
      {(
        [
          { key: "unread", label: "Unread", icon: "mail" },
          { key: "starred", label: "Flagged", icon: "star" },
        ] as const
      ).map((item) => {
        const selected = !!value[item.key];
        return (
          <FilterChip
            key={item.key}
            label={item.label}
            icon={item.icon}
            selected={selected}
            color={color}
            onPress={() => {
              const next = { ...value };
              if (selected) delete next[item.key];
              else next[item.key] = true;
              onChange(next);
            }}
          />
        );
      })}
      {(value.unread || value.starred) && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear mail filters"
          onPress={() => onChange({})}
          style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 8 }}
        >
          <Text style={{ color: t.secondary, fontSize: 14 }}>Clear</Text>
        </Pressable>
      )}
    </View>
  );
}
