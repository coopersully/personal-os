import type { PropsWithChildren } from "react";
import { Text, View } from "react-native";
import { spacing, useTheme } from "../../theme";

/** A content row (such as RecordRow) inside a group takes the group's side padding here. */
export function SectionItem({ children }: PropsWithChildren) {
  return <View style={{ paddingHorizontal: spacing.lg }}>{children}</View>;
}
/** Explanatory or read-only copy inside a group, aligned with the rows around it. */
export function SectionNote({ children, ink = false }: PropsWithChildren<{ ink?: boolean }>) {
  const t = useTheme();
  return (
    <Text
      style={{
        color: ink ? t.ink : t.secondary,
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
