import { useEffect, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme, workspaceColor } from "../../theme";
import { GlassSurface } from "../glass-surface";
import { Icon } from "../icons";
export function FormSave({
  disabled,
  onPress,
  workspace = "tasks",
  keyboardOffset,
}: {
  disabled: boolean;
  onPress: () => void;
  workspace?: string;
  keyboardOffset?: number;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      pointerEvents="box-none"
      behavior={keyboardOffset === undefined && Platform.OS === "ios" ? "padding" : undefined}
      style={{ position: "absolute", bottom: keyboardOffset ?? 0, right: 20 }}
    >
      <GlassSurface
        style={{
          width: 56,
          height: 56,
          borderRadius: 28,
          overflow: "hidden",
          marginBottom: Math.max(insets.bottom, 16),
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save changes"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={onPress}
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            opacity: disabled ? 0.7 : 1,
          }}
        >
          <Icon name="save" size={27} color={disabled ? t.ink : workspaceColor(t, workspace)} />
        </Pressable>
      </GlassSurface>
    </KeyboardAvoidingView>
  );
}

/** Use screen-space keyboard geometry for native modal forms with a floating action. */
export function useFormKeyboardOffset() {
  const { height } = useWindowDimensions();
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const change = Keyboard.addListener("keyboardWillChangeFrame", (event) => {
      setOffset(Math.max(0, height - event.endCoordinates.screenY));
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => setOffset(0));
    return () => {
      change.remove();
      hide.remove();
    };
  }, [height]);
  return offset;
}
