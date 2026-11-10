import { Image, type ImageSourcePropType, Text, View } from "react-native";
import { useTheme } from "../../theme";

// Generated only by scripts/generate-provider-marks.mjs from the canonical web BrandMark.
// These are trademark artwork, not tintable interface icons or account profile photos.
const marks: Record<
  string,
  { title: string; light: ImageSourcePropType; dark: ImageSourcePropType }
> = {
  google: {
    title: "Google",
    light: require("../../../assets/providers/google-color.png"),
    dark: require("../../../assets/providers/google-color.png"),
  },
  apple: {
    title: "Apple",
    light: require("../../../assets/providers/apple-light.png"),
    dark: require("../../../assets/providers/apple-dark.png"),
  },
  icloud: {
    title: "iCloud",
    light: require("../../../assets/providers/icloud-light.png"),
    dark: require("../../../assets/providers/icloud-dark.png"),
  },
  x: {
    title: "X",
    light: require("../../../assets/providers/x-light.png"),
    dark: require("../../../assets/providers/x-dark.png"),
  },
};
export function ProviderMark({
  brand,
  size = 24,
  decorative = false,
}: {
  brand: string;
  size?: number;
  decorative?: boolean;
}) {
  const t = useTheme();
  const key = brand.trim().toLowerCase();
  const mark = Object.hasOwn(marks, key) ? marks[key] : undefined;
  if (mark)
    return (
      <Image
        source={t.dark ? mark.dark : mark.light}
        resizeMode="contain"
        accessible={!decorative}
        accessibilityLabel={decorative ? undefined : mark.title}
        style={{ width: size, height: size }}
      />
    );
  return (
    <View
      accessible={!decorative}
      accessibilityLabel={decorative ? undefined : brand}
      style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}
    >
      <Text accessible={false} style={{ color: t.ink, fontSize: 16, fontWeight: "600" }}>
        {brand.trim().slice(0, 1).toUpperCase() || "?"}
      </Text>
    </View>
  );
}
