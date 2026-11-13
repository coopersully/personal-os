import { type ReactNode, useState } from "react";
import { type LayoutChangeEvent, Text, View } from "react-native";
import { spacing, useTheme } from "../theme";
import { EditorClose } from "./editor-close";

/**
 * Standalone modal chrome; glass belongs to controls, not the reading surface.
 *
 * Both side slots reserve the width of the wider one, so the title is centered on the sheet
 * rather than in whatever space the dismissal leaves, and a long title truncates between
 * the controls instead of running under them.
 */
export function SheetHeader({
  title,
  label = "Close",
  onClose,
  disabled = false,
  trailing,
  inset = true,
}: {
  title: string;
  label?: string;
  onClose: () => void;
  disabled?: boolean;
  trailing?: ReactNode;
  inset?: boolean;
}) {
  const t = useTheme();
  const [side, setSide] = useState(0);
  const measure = (event: LayoutChangeEvent) => {
    const width = Math.ceil(event.nativeEvent.layout.width);
    setSide((current) => Math.max(current, width));
  };
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
      <View testID="sheet-header-leading" style={{ minWidth: side, alignItems: "flex-start" }}>
        <View onLayout={measure}>
          <EditorClose label={label} onPress={onClose} disabled={disabled} />
        </View>
      </View>
      <Text
        accessibilityRole="header"
        numberOfLines={1}
        style={{
          flex: 1,
          minWidth: 0,
          color: t.ink,
          fontSize: 17,
          fontWeight: "600",
          textAlign: "center",
        }}
      >
        {title}
      </Text>
      <View testID="sheet-header-trailing" style={{ minWidth: side, alignItems: "flex-end" }}>
        <View onLayout={measure}>{trailing}</View>
      </View>
    </View>
  );
}
