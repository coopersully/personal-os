import { type ReactNode, useState } from "react";
import { type LayoutChangeEvent, Text, View } from "react-native";
import { spacing, useTheme } from "../theme";
import { EditorClose } from "./editor-close";

/**
 * Standalone modal chrome; glass belongs to controls, not the reading surface.
 *
 * Both side slots reserve the width of the wider one, so the title is centered on the sheet
 * rather than in whatever space the dismissal leaves, and a long title truncates between
 * the controls instead of running under them. The title stays hidden until the sides are
 * measured, so the first frame is never off-center.
 *
 * A sheet that only confirms (Done) puts its control on the trailing side with
 * `dismiss="trailing"`; a sheet that can be abandoned keeps Close or Cancel leading and
 * passes its confirming control as `trailing`.
 */
export function SheetHeader({
  title,
  label = "Close",
  onClose,
  disabled = false,
  trailing,
  dismiss = "leading",
  inset = true,
}: {
  title: string;
  label?: string;
  onClose: () => void;
  disabled?: boolean;
  trailing?: ReactNode;
  dismiss?: "leading" | "trailing";
  inset?: boolean;
}) {
  const t = useTheme();
  // Each slot keeps its own latest width, so a control that narrows gives the title room back.
  const [widths, setWidths] = useState<{ leading: number | null; trailing: number | null }>({
    leading: null,
    trailing: null,
  });
  const measure = (slot: "leading" | "trailing") => (event: LayoutChangeEvent) => {
    const width = Math.ceil(event.nativeEvent.layout.width);
    setWidths((current) => (current[slot] === width ? current : { ...current, [slot]: width }));
  };
  const side = Math.max(widths.leading ?? 0, widths.trailing ?? 0);
  const measured = widths.leading !== null && widths.trailing !== null;
  const close = <EditorClose label={label} onPress={onClose} disabled={disabled} />;
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
        <View onLayout={measure("leading")}>{dismiss === "leading" ? close : null}</View>
      </View>
      <Text
        accessibilityRole="header"
        numberOfLines={1}
        // Scale with the controls beside it (they cap at 1.3), then shrink before truncating,
        // so large text never leaves a clipped title between full-size buttons.
        maxFontSizeMultiplier={1.3}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        style={{
          flex: 1,
          minWidth: 0,
          color: t.ink,
          fontSize: 17,
          fontWeight: "600",
          textAlign: "center",
          opacity: measured ? 1 : 0,
        }}
      >
        {title}
      </Text>
      <View testID="sheet-header-trailing" style={{ minWidth: side, alignItems: "flex-end" }}>
        <View onLayout={measure("trailing")}>{dismiss === "trailing" ? close : trailing}</View>
      </View>
    </View>
  );
}
