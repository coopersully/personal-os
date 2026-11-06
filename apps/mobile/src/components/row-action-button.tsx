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
  placement?: "card" | "header";
  label: string;
  actions: readonly RowAction[];
};
export function RowActionButton({
  action,
  placement,
}: {
  action: RowAction;
  placement?: "card" | "header";
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
        alignItems: placement === "header" ? "center" : "flex-end",
        justifyContent: placement === "header" ? "center" : "flex-start",
        opacity: action.disabled ? 0.4 : pressed ? 0.6 : 1,
      })}
    >
      <Icon
        name={action.icon}
        size={20}
        color={
          action.destructive
            ? placement === "header"
              ? "#ba2944"
              : t.destructive
            : placement === "header"
              ? "#202024"
              : t.ink
        }
      />
    </Pressable>
  );
}
