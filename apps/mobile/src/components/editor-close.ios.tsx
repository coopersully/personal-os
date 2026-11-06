import { Button, Host, Text } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  disabled,
  font,
  foregroundStyle,
  frame,
} from "@expo/ui/swift-ui/modifiers";
/** Let the native header choose its glass appearance and adaptive label color. */
export function EditorClose({
  label,
  onPress,
  disabled: inactive = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Host colorScheme="light" style={{ width: 76, height: 44 }} ignoreSafeArea="all">
      <Button onPress={onPress} modifiers={[disabled(inactive), accessibilityLabel(label)]}>
        <Text
          modifiers={[
            font({ size: 17, weight: "semibold" }),
            foregroundStyle("#202024"),
            frame({ minWidth: 60, minHeight: 44 }),
          ]}
        >
          {label}
        </Text>
      </Button>
    </Host>
  );
}
