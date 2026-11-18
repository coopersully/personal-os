import { useState } from "react";
import { Image, type ImageSourcePropType, Text } from "react-native";

/** A failed bitmap retains its semantic place and dimensions instead of leaving a blank row. */
export function IconImage({
  name,
  source,
  color,
  size,
}: {
  name: string;
  source: ImageSourcePropType;
  color: string;
  size: number;
}) {
  const [failedSource, setFailedSource] = useState<ImageSourcePropType | null>(null);
  if (failedSource === source) {
    const initials: Record<string, string> = {
      profile: "U",
      people: "U",
      disconnected: "L",
      location: "L",
      chevron: "N",
      add: "A",
      save: "S",
      cancel: "X",
      search: "S",
    };
    return (
      <Text
        accessible={false}
        numberOfLines={1}
        style={{
          width: size,
          height: size,
          flexShrink: 0,
          color,
          textAlign: "center",
          lineHeight: size,
          fontSize: size * 0.7,
          fontWeight: "600",
        }}
      >
        {initials[name] ?? name.charAt(0).toUpperCase()}
      </Text>
    );
  }
  return (
    <Image
      accessible={false}
      source={source}
      onError={() => setFailedSource(source)}
      style={{ width: size, height: size, flexShrink: 0, tintColor: color }}
    />
  );
}
