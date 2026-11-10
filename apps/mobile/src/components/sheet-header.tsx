import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { spacing, useTheme } from "../theme";
import { EditorClose } from "./editor-close";

/** Standalone modal chrome; glass belongs to controls, not the reading surface. */
export function SheetHeader({
  title,
  label = "Close",
  onClose,
  trailing,
  inset = true,
}: {
  title: string;
  label?: string;
  onClose: () => void;
  trailing?: ReactNode;
  inset?: boolean;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        minHeight: 60,
        paddingVertical: spacing.sm,
        paddingHorizontal: inset ? spacing.page : 0,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
      }}
    >
      <EditorClose label={label} onPress={onClose} />
      <Text
        accessibilityRole="header"
        style={{ flex: 1, color: t.ink, fontSize: 17, fontWeight: "600", textAlign: "center" }}
      >
        {title}
      </Text>
      {trailing}
    </View>
  );
}
