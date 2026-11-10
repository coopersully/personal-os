import { Text, View } from "react-native";
import { spacing, useTheme } from "../../theme";
import { Icon, type IconName } from "../icons";

export interface EnumChoiceProps {
  label: string;
  value: string | null;
  valueLabel?: string;
  valueColor?: string;
  options: readonly { value: string; label: string; icon?: IconName; color?: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  icon?: IconName;
}
/** Field concepts own their glyph; option wording never changes field identity. */
const fieldIcons: Record<string, IconName> = {
  Priority: "attention",
  "Debt priority": "attention",
  "Item type": "tasks",
  Sort: "views",
  "Sort by": "views",
  "Container sort": "views",
  Group: "categoryLayers",
  "Group by": "categoryLayers",
  Theme: "today",
  Actor: "profile",
  "Agent identity": "profile",
  Platform: "disconnected",
  Workspace: "grid",
  "Message detail": "mail",
  "Quiet hours": "clock",
  Country: "location",
  "Default calendar": "calendar",
  "Busy-block privacy": "calendar",
  "Important email": "mail",
  "Inbox style": "inbox",
  "Noise handling": "mail",
  "Income stability": "wallet",
  "Debt account": "finances",
  Goal: "target",
  Status: "check",
  Kind: "categoryLayers",
  Ownership: "people",
  Planning: "wallet",
  "Step type": "tasks",
  Ritual: "today",
  Order: "views",
};
export function EnumChoiceLabel({
  label,
  value,
  valueLabel,
  valueColor,
  options,
  icon,
}: EnumChoiceProps) {
  const t = useTheme();
  const glyph = icon ?? fieldIcons[label];
  return (
    <View
      style={{
        minHeight: 56,
        padding: spacing.lg,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
      }}
    >
      {glyph && <Icon name={glyph} color={t.secondary} size={22} />}
      <Text style={{ flex: 1, color: t.ink, fontSize: 17 }}>{label}</Text>
      <Text
        numberOfLines={1}
        style={{
          maxWidth: "55%",
          flexShrink: 1,
          textAlign: "right",
          color: valueColor ?? t.secondary,
          fontSize: 17,
        }}
      >
        {valueLabel ?? options.find((option) => option.value === value)?.label ?? "None"}
      </Text>
      <Icon name="chevron" color={t.secondary} size={16} />
    </View>
  );
}
