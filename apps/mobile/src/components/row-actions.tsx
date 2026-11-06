import { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { radius, spacing, touchTarget, useTheme } from "../theme";
import { Icon } from "./icons";
import { RowActionButton, type RowActionsProps } from "./row-action-button";
export function RowActions({ label, actions, placement }: RowActionsProps) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  if (!actions.length) return null;
  if (actions.length === 1) return <RowActionButton action={actions[0]} placement={placement} />;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        style={{
          width: touchTarget,
          minHeight: touchTarget,
          alignSelf: "flex-start",
          alignItems: placement === "header" ? "center" : "flex-end",
          justifyContent: placement === "header" ? "center" : "flex-start",
        }}
      >
        <Text style={{ fontSize: 26, color: t.secondary }}>⋮</Text>
      </Pressable>
      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          accessibilityLabel="Dismiss actions"
          onPress={() => setOpen(false)}
          style={{ position: "absolute", inset: 0 }}
        />
        <View
          accessibilityViewIsModal
          style={{
            alignSelf: "flex-end",
            marginTop: 120,
            marginRight: spacing.page,
            padding: spacing.sm,
            borderRadius: radius.menu,
            backgroundColor: t.surface,
            maxWidth: "90%",
          }}
        >
          {[...actions.filter((a) => !a.destructive), ...actions.filter((a) => a.destructive)].map(
            (action, index, ordered) => (
              <Pressable
                key={action.id}
                accessibilityRole="button"
                disabled={action.disabled}
                accessibilityState={{ disabled: !!action.disabled }}
                onPress={() => {
                  setOpen(false);
                  action.onPress();
                }}
                style={{
                  borderTopWidth:
                    action.destructive && index > 0 && !ordered[index - 1].destructive ? 1 : 0,
                  borderTopColor: t.line,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  padding: spacing.lg,
                  minHeight: touchTarget,
                  opacity: action.disabled ? 0.4 : 1,
                }}
              >
                <Icon name={action.icon} color={action.destructive ? t.destructive : t.ink} />
                <Text style={{ color: action.destructive ? t.destructive : t.ink, fontSize: 17 }}>
                  {action.label}
                </Text>
              </Pressable>
            ),
          )}
        </View>
      </Modal>
    </>
  );
}
