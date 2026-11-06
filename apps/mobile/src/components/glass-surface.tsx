import { GlassView, type GlassViewProps, isLiquidGlassAvailable } from "expo-glass-effect";
import { Platform, StyleSheet } from "react-native";
import { useTheme } from "../theme";

/** Native Liquid Glass, with a translucent material for the browser preview. */
export function GlassSurface({ style, ...props }: GlassViewProps) {
  const theme = useTheme();
  const nativeGlass = Platform.OS === "ios" && isLiquidGlassAvailable();
  return (
    <GlassView
      glassEffectStyle="regular"
      {...props}
      style={[
        !nativeGlass && {
          backgroundColor:
            Platform.OS === "web"
              ? theme.dark
                ? "rgba(45,45,52,0.62)"
                : "rgba(255,255,255,0.64)"
              : theme.surface,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.dark ? "#ffffff30" : "#ffffffcc",
          ...(Platform.OS === "web" && {
            backdropFilter: "blur(24px) saturate(180%)",
            boxShadow: theme.dark
              ? "inset 0 1px 0 #ffffff24, 0 8px 24px #00000024"
              : "inset 0 1px 0 #ffffffcc, 0 8px 24px #00000010",
          }),
        },
        style,
      ]}
    />
  );
}
