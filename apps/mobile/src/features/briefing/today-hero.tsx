import { useId } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from "react-native-svg";
import { useTodaySky } from "./sky-context";

/** Smooth, resolution-independent atmospheric color; deliberately no particles or dithering. */
export function TodayHeroBackdrop() {
  const { sky } = useTodaySky();
  const id = useId().replace(/:/g, "");
  return (
    <View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, { backgroundColor: sky.topColor, overflow: "hidden" }]}
    >
      <Svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 390 200">
        <Defs>
          <LinearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={sky.topColor} />
            <Stop offset="1" stopColor={sky.bottomColor} />
          </LinearGradient>
          <RadialGradient id={`${id}-haze`} cx="85%" cy="65%" rx="70%" ry="45%">
            <Stop offset="0" stopColor={sky.hazeColor} stopOpacity={sky.hazeOpacity} />
            <Stop offset="1" stopColor={sky.hazeColor} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect width="390" height="200" fill={`url(#${id}-sky)`} />
        <Rect width="390" height="200" fill={`url(#${id}-haze)`} />
      </Svg>
    </View>
  );
}
