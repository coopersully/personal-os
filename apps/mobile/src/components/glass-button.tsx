import { Pressable, Text, type ViewStyle } from "react-native";
import { useTheme } from "../theme";
import { GlassSurface } from "./glass-surface";
import { Icon, type IconName } from "./icons";

/** The only two glass control heights: a bar control and a floating action. */
export const glassButtonSize = { bar: 44, floating: 56 } as const;

/**
 * The one Liquid Glass button. Geometry and label color are fixed here so a screen cannot
 * squeeze a label into a circle or tint it into the material: text is always primary ink on
 * a capsule that grows with its label, and an icon-only control is always a circle.
 */
export function GlassButton({
  label,
  icon,
  size = "bar",
  tint,
  disabled = false,
  onPress,
  style,
}: {
  /** Visible text for a capsule; the accessible name for an icon-only circle. */
  label: string;
  icon?: IconName;
  size?: keyof typeof glassButtonSize;
  /** Enabled glyph color for icon buttons. Text labels always use primary ink. */
  tint?: string;
  disabled?: boolean;
  onPress: () => void;
  /** Placement only (margins, position); size and shape are not negotiable. */
  style?: ViewStyle;
}) {
  const t = useTheme();
  const height = glassButtonSize[size];
  return (
    <GlassSurface
      isInteractive
      colorScheme={t.dark ? "dark" : "light"}
      style={{
        ...style,
        height,
        minWidth: height,
        borderRadius: height / 2,
        overflow: "hidden",
        ...(icon ? { width: height } : { flexShrink: 0 }),
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => ({
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: icon ? 0 : 16,
          opacity: disabled ? 0.5 : pressed ? 0.6 : 1,
        })}
      >
        {icon ? (
          <Icon
            name={icon}
            size={size === "floating" ? 27 : 22}
            color={disabled ? t.ink : (tint ?? t.ink)}
          />
        ) : (
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1.3}
            style={{ color: t.ink, fontSize: 17, fontWeight: "500" }}
          >
            {label}
          </Text>
        )}
      </Pressable>
    </GlassSurface>
  );
}
