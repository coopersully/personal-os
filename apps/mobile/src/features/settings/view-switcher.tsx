import { Pressable, ScrollView, Text, View } from "react-native";
import { FilterChip } from "../../components/filter-chip";
import type { IconName } from "../../components/icons";
import { useTheme } from "../../theme";

/** Compact navigation between peer views; never a vertical list of form options. */
export function SettingsViewSwitcher({
  value,
  options,
  onChange,
}: {
  value: string;
  options: readonly { value: string; label: string; icon?: IconName }[];
  onChange: (value: string) => void;
}) {
  const t = useTheme();
  if (options.length <= 3)
    return (
      <View
        style={{
          flexDirection: "row",
          padding: 4,
          gap: 4,
          borderRadius: 12,
          backgroundColor: t.surface,
        }}
      >
        {options.map((option) => (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityLabel={option.label}
            accessibilityState={{ selected: value === option.value }}
            onPress={() => onChange(option.value)}
            style={{
              flex: 1,
              minHeight: 44,
              paddingHorizontal: 4,
              paddingVertical: 8,
              borderRadius: 9,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: value === option.value ? t.canvas : "transparent",
            }}
          >
            <Text
              style={{
                color: t.ink,
                fontSize: 14,
                fontWeight: value === option.value ? "600" : "400",
                textAlign: "center",
              }}
            >
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
    );
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
    >
      {options.map((option) => (
        <FilterChip
          key={option.value}
          label={option.label}
          icon={option.icon}
          selected={value === option.value}
          color={t.ink}
          onPress={() => onChange(option.value)}
        />
      ))}
    </ScrollView>
  );
}
