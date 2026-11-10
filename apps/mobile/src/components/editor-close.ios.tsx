import { Button, Host, Text } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  buttonBorderShape,
  buttonStyle,
  disabled,
  font,
  frame,
  padding,
} from "@expo/ui/swift-ui/modifiers";
import { Platform } from "react-native";
import { useTheme } from "../theme";
/** Standalone sheet action. Stack headers use UIKit items via editorDismissOptions. */
export function EditorClose({
  label,
  onPress,
  disabled: inactive = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <Host matchContents colorScheme={t.dark ? "dark" : "light"} ignoreSafeArea="all">
      <Button
        onPress={onPress}
        modifiers={[
          buttonStyle(Number(Platform.Version) >= 26 ? "glass" : "bordered"),
          buttonBorderShape("capsule"),
          disabled(inactive),
          accessibilityLabel(label),
        ]}
      >
        <Text
          modifiers={[
            font({ size: 17, weight: "regular" }),
            padding({ horizontal: 8 }),
            frame({ minHeight: 28 }),
          ]}
        >
          {label}
        </Text>
      </Button>
    </Host>
  );
}
