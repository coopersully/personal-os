import { Pressable } from "react-native";
import { touchTarget, useTheme } from "../theme";
import { Icon, type IconName } from "./icons";
export type RowAction = {
  id: string;
  label: string;
  icon: IconName;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
};
export type RowActionsProps = {
  placement?: "card" | "header" | "toolbar";
  label: string;
  actions: readonly RowAction[];
};
export function RowActionButton({
  action,
  placement,
}: {
  action: RowAction;
  placement?: "card" | "header" | "toolbar";
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={action.label}
      accessibilityState={{ disabled: !!action.disabled }}
      disabled={action.disabled}
      onPress={action.onPress}
      style={({ pressed }) => ({
        width: touchTarget,
        minHeight: touchTarget,
        alignSelf: "flex-start",
        alignItems: placement !== "card" && placement !== undefined ? "center" : "flex-end",
        justifyContent: placement !== "card" && placement !== undefined ? "center" : "flex-start",
        opacity: action.disabled ? 0.4 : pressed ? 0.6 : 1,
      })}
    >
      <Icon name={action.icon} size={20} color={action.destructive ? t.destructive : t.ink} />
    </Pressable>
  );
}
