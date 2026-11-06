import type { TaskWorkspaceQuery } from "@personal-os/domain";
import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { radius, spacing, touchTarget, useTheme } from "../../theme";
import { Action, Choice } from "./ui";
export type OptionsMenuProps = {
  choices: {
    key: keyof TaskWorkspaceQuery;
    label: string;
    value: string;
    section: "filter" | "presentation";
    options: { value: string; label: string }[];
  }[];
  onChange: (key: keyof TaskWorkspaceQuery, value: string) => void;
  onAdvanced: () => void;
  onReset: () => void;
};
export function OptionsMenu({ choices, onChange, onAdvanced, onReset }: OptionsMenuProps) {
  const t = useTheme();
  const [open, setOpen] = useState(false);

  const close = () => {
    setOpen(false);
  };
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Task view options"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={{
          minWidth: touchTarget,
          minHeight: touchTarget,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ fontSize: 26, color: t.ink }}>⋮</Text>
      </Pressable>
      <Modal transparent visible={open} onRequestClose={close} animationType="fade">
        <Pressable
          accessibilityLabel="Dismiss view options"
          onPress={close}
          style={{ position: "absolute", inset: 0 }}
        />
        <View
          accessibilityViewIsModal
          style={{
            alignSelf: "flex-end",
            marginTop: 120,
            marginRight: spacing.page,
            width: 300,
            maxWidth: "90%",
            maxHeight: "70%",
            borderRadius: radius.menu,
            backgroundColor: t.surface,
            overflow: "hidden",
          }}
        >
          <ScrollView keyboardShouldPersistTaps="handled">
            <Action
              label="Filters…"
              onPress={() => {
                close();
                onAdvanced();
              }}
            />
            {choices
              .filter((choice) => choice.section === "presentation")
              .map((choice) => (
                <Choice
                  key={choice.key}
                  label={choice.label}
                  value={choice.value}
                  options={choice.options}
                  onChange={(value) => {
                    onChange(choice.key, value);
                    close();
                  }}
                />
              ))}
            <Action
              label="Reset view"
              onPress={() => {
                close();
                onReset();
              }}
            />
            <Action label="Close" onPress={close} />
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}
