import { useEffect, useState } from "react";
import { Keyboard, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassButton } from "../glass-button";
import type { IconName } from "../icons";
import { useSettingsAccent } from "../settings-accent";
/** Floating bottom-right form action; the shared glass button owns its size and contrast. */
export function FormSave({
  disabled,
  onPress,
  workspace = "tasks",
  keyboardOffset,
  label = "Save changes",
  icon = "save",
}: {
  label?: string;
  icon?: IconName;
  disabled: boolean;
  onPress: () => void;
  workspace?: string;
  keyboardOffset?: number;
}) {
  const accent = useSettingsAccent(workspace);
  const insets = useSafeAreaInsets();
  const defaultKeyboardOffset = useFormKeyboardOffset(keyboardOffset === undefined);
  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", bottom: keyboardOffset ?? defaultKeyboardOffset, right: 20 }}
    >
      <GlassButton
        size="floating"
        label={label}
        icon={icon}
        tint={accent}
        disabled={disabled}
        onPress={onPress}
        style={{ marginBottom: Math.max(insets.bottom, 16) }}
      />
    </View>
  );
}

/** Use screen-space keyboard geometry for forms with a floating action. */
export function useFormKeyboardOffset(enabled = true) {
  const { height } = useWindowDimensions();
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const change = Keyboard.addListener("keyboardWillChangeFrame", (event) => {
      setOffset(Math.max(0, height - event.endCoordinates.screenY));
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => setOffset(0));
    return () => {
      change.remove();
      hide.remove();
    };
  }, [enabled, height]);
  return offset;
}

export function FloatingAdd({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return <FormSave label={label} icon="add" disabled={disabled} onPress={onPress} />;
}
