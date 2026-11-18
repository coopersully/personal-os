import { useState } from "react";
import { Image, Text, View } from "react-native";
import { useTheme } from "../../theme";
/** Provider-supplied photo only: never send an email to a third-party avatar service. */
export function AccountAvatar({ url, name }: { url?: string | null; name: string }) {
  const t = useTheme();
  const [failed, setFailed] = useState<string | null>(null);
  const photo = url && /^https:\/\//i.test(url) && failed !== url;
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0))
      .join("")
      .toUpperCase() || "?";
  return (
    <View
      style={{
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: t.canvas,
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {photo ? (
        <Image
          source={{ uri: url }}
          accessibilityLabel={`Profile picture for ${name}`}
          onError={() => setFailed(url)}
          style={{ width: 40, height: 40 }}
        />
      ) : (
        <Text accessible={false} style={{ color: t.ink, fontSize: 16, fontWeight: "600" }}>
          {initials}
        </Text>
      )}
    </View>
  );
}
