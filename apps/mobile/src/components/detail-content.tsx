import type { PropsWithChildren } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../theme";

export function Heading({ children }: PropsWithChildren) {
  const t = useTheme();
  return (
    <Text accessibilityRole="header" style={[styles.heading, { color: t.ink }]}>
      {children}
    </Text>
  );
}
export function Body({ children }: PropsWithChildren) {
  const t = useTheme();
  return <Text style={[styles.body, { color: t.secondary }]}>{children}</Text>;
}
export function Facts({ facts }: { facts: { label: string; value: string }[] }) {
  const t = useTheme();
  return (
    <View style={styles.facts}>
      {facts.map((fact) => (
        <View key={fact.label} style={[styles.fact, { borderBottomColor: t.line }]}>
          <Text style={[styles.label, { color: t.secondary }]}>{fact.label}</Text>
          <Text style={[styles.value, { color: t.ink }]}>{fact.value}</Text>
        </View>
      ))}
    </View>
  );
}
export function Button({
  children,
  onPress,
  disabled = false,
}: PropsWithChildren<{ onPress: () => void; disabled?: boolean }>) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: t.ink, opacity: disabled ? 0.45 : pressed ? 0.7 : 1 },
      ]}
    >
      <Text style={[styles.buttonText, { color: t.canvas }]}>{children}</Text>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  heading: { fontSize: 28, fontWeight: "600", letterSpacing: -0.7, marginBottom: 12 },
  body: { fontSize: 15, lineHeight: 24, marginBottom: 16 },
  facts: { marginBottom: 24 },
  fact: { paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  label: { fontSize: 12, marginBottom: 6 },
  value: { fontSize: 16, lineHeight: 25 },
  button: {
    minHeight: 48,
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 8,
  },
  buttonText: { fontSize: 15, fontWeight: "600" },
});
