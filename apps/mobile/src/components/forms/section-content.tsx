import type { PropsWithChildren } from "react";
import { Text, View } from "react-native";
import { spacing, useTheme } from "../../theme";

/** A content row (such as RecordRow) inside a group takes the group's side padding here. */
export function SectionItem({ children }: PropsWithChildren) {
  return (
    <View testID="section-item" style={{ paddingHorizontal: spacing.lg }}>
      {children}
    </View>
  );
}
/** Explanatory or read-only copy inside a group, aligned with the rows around it. */
export function SectionNote({
  children,
  ink = false,
  warning = false,
  selectable = false,
}: PropsWithChildren<{ ink?: boolean; warning?: boolean; selectable?: boolean }>) {
  const t = useTheme();
  return (
    <Text
      selectable={selectable}
      style={{
        color: warning ? t.warning : ink ? t.ink : t.secondary,
        fontSize: 15,
        lineHeight: 21,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
      }}
    >
      {children}
    </Text>
  );
}
/** Explanatory copy that belongs to the group above it, set under the group's edge. */
export function SectionFootnote({ children }: PropsWithChildren) {
  const t = useTheme();
  return (
    <Text
      style={{
        color: t.secondary,
        fontSize: 13,
        lineHeight: 18,
        marginHorizontal: spacing.lg,
        marginTop: -spacing.md,
        marginBottom: spacing.xl,
      }}
    >
      {children}
    </Text>
  );
}
