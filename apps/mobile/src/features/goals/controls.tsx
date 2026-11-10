import type { PropsWithChildren } from "react";
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View } from "react-native";
import { useTheme } from "../../theme";
export function Action({
  children,
  onPress,
  disabled = false,
}: PropsWithChildren<{ onPress: () => void; disabled?: boolean }>) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      accessibilityState={{ disabled }}
      onPress={onPress}
      style={{ minHeight: 44, justifyContent: "center", opacity: disabled ? 0.5 : 1 }}
    >
      <Text style={{ color: t.information }}>{children}</Text>
    </Pressable>
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
  const t = useTheme();
  return (
    <View style={{ gap: 8, marginVertical: 8 }}>
      <Text style={{ color: t.secondary }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={t.secondary}
        multiline={multiline}
        style={{
          color: t.ink,
          backgroundColor: t.surface,
          borderRadius: 12,
          padding: 12,
          minHeight: 48,
        }}
      />
    </View>
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
