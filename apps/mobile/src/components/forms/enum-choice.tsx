import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { radius, spacing, useTheme } from "../../theme";
import { Icon } from "../icons";

import { EnumChoiceLabel, type EnumChoiceProps } from "./enum-choice-label";

export type { EnumChoiceProps } from "./enum-choice-label";

/** Accessible non-iOS fallback; iOS resolves the system popup implementation. */
export function EnumChoice(props: EnumChoiceProps) {
  const { label, value, options, onChange, disabled } = props;
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const selected =
    props.valueLabel ?? options.find((option) => option.value === value)?.label ?? "None";
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${selected}`}
        accessibilityState={{ disabled: !!disabled, expanded: open }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={{ opacity: disabled ? 0.4 : 1 }}
      >
        <EnumChoiceLabel {...props} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View
          accessibilityViewIsModal
          style={{
            flex: 1,
            justifyContent: "center",
            padding: spacing.xl,
            backgroundColor: t.canvas,
          }}
        >
          <View
            style={{
              backgroundColor: t.surface,
              borderRadius: radius.panel,
              padding: spacing.lg,
              maxHeight: "80%",
            }}
          >
            <Text accessibilityRole="header" style={{ color: t.ink, fontSize: 20 }}>
              {label}
            </Text>
            <ScrollView>
              {options.map((option) => (
                <Pressable
                  key={option.value}
                  disabled={disabled}
                  accessibilityRole="radio"
                  accessibilityLabel={option.label}
                  accessibilityState={{ checked: option.value === value, disabled: !!disabled }}
                  onPress={() => {
                    if (disabled) return;
                    if (option.value !== value) onChange(option.value);
                    setOpen(false);
                  }}
                  style={{
                    minHeight: 48,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: spacing.md,
                  }}
                >
                  {option.icon && <Icon name={option.icon} color={t.secondary} />}
                  <Text style={{ flex: 1, color: t.ink, fontSize: 17 }}>{option.label}</Text>
                  {option.value === value && <Icon name="save" color={t.ink} />}
                </Pressable>
              ))}
            </ScrollView>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Cancel ${label.toLowerCase()}`}
              onPress={() => setOpen(false)}
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <Text style={{ color: t.ink }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}
