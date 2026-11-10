import { Children, type PropsWithChildren } from "react";
import { ActivityIndicator, Alert } from "react-native";
import { SettingsActionRow } from "../settings/settings-row";
import { Field as SharedField } from "../tasks/ui";

export { Section, ToggleRow } from "../tasks/ui";
export function Action({
  children,
  onPress,
  disabled = false,
  destructive = false,
}: PropsWithChildren<{ onPress: () => void; disabled?: boolean; destructive?: boolean }>) {
  const label = Children.toArray(children).join("");
  return (
    <SettingsActionRow
      label={label}
      icon={destructive ? "trash" : undefined}
      onPress={onPress}
      disabled={disabled}
      destructive={destructive}
    />
  );
}
export function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  return (
    <SharedField
      label={label}
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      multiline={multiline}
      compact={!multiline}
    />
  );
}
export function ReadState({
  pending,
  error,
  retry,
}: {
  pending: boolean;
  error: boolean;
  retry: () => void;
}) {
  return pending ? (
    <ActivityIndicator accessibilityLabel="Loading" />
  ) : error ? (
    <Action onPress={retry}>Unable to load. Retry</Action>
  ) : null;
}
export function confirmDiscard(close: () => void) {
  Alert.alert("Discard changes?", "Your unsaved changes will be lost.", [
    { text: "Keep editing", style: "cancel" },
    { text: "Discard", style: "destructive", onPress: close },
  ]);
}
export function confirmDelete(title: string, remove: () => void) {
  Alert.alert(`Delete ${title}?`, "This permanently deletes this record. This cannot be undone.", [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: remove },
  ]);
}
