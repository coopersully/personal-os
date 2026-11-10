import { Text, type TextProps } from "react-native";
import { useTheme } from "../theme";
/** Both columns can shrink and wrap; the icon/accessory keep their own fixed space. */
export function SettingLabel({ style, ...props }: TextProps) {
  const t = useTheme();
  return (
    <Text
      {...props}
      style={[{ flex: 1, flexShrink: 1, minWidth: 0, color: t.ink, fontSize: 17 }, style]}
    />
  );
}
export function SettingValue({ style, ...props }: TextProps) {
  const t = useTheme();
  return (
    <Text
      {...props}
      style={[
        {
          maxWidth: "65%",
          minWidth: 0,
          flexShrink: 1,
          textAlign: "right",
          color: t.secondary,
          fontSize: 17,
        },
        style,
      ]}
    />
  );
}
