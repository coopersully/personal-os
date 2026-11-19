import { router, Stack } from "expo-router";
import type { PropsWithChildren } from "react";
import { View } from "react-native";
import { editorDismissOptions } from "../../components/editor-header";
import { FormSave, useFormKeyboardOffset } from "../../components/forms/form-save";
import type { IconName } from "../../components/icons";
import { confirmChoice } from "./goal-confirm";
import { FinanceScreen } from "./ui";

/** Shared chrome of a Cash flow form: dismissal with a discard prompt, and the floating action. */
export function CashflowForm({
  title,
  edited,
  pending,
  invalid,
  saveLabel,
  saveIcon,
  discard = "Unsaved entries will be lost.",
  onSave,
  children,
}: PropsWithChildren<{
  title: string;
  edited: boolean;
  pending: boolean;
  invalid: boolean;
  saveLabel?: string;
  saveIcon?: IconName;
  discard?: string;
  onSave: () => void;
}>) {
  const keyboardOffset = useFormKeyboardOffset();
  const close = () =>
    edited
      ? confirmChoice({
          title: "Discard changes?",
          message: discard,
          cancel: "Keep editing",
          accept: "Discard",
          destructive: true,
          onAccept: () => router.back(),
        })
      : router.back();
  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          // The page heading below names the screen; the bar carries only dismissal.
          title: "",
          gestureEnabled: false,
          headerBackVisible: false,
          ...editorDismissOptions({
            label: edited ? "Cancel" : "Close",
            onPress: close,
            disabled: pending,
          }),
        }}
      />
      <FinanceScreen title={title}>
        {children}
        {/* Clears the floating action, also when it rides above the keyboard, so the last
            row can always be scrolled into full view. */}
        <View style={{ height: 120 + keyboardOffset }} />
      </FinanceScreen>
      <FormSave
        workspace="finances"
        keyboardOffset={keyboardOffset}
        disabled={!edited || pending || invalid}
        onPress={onSave}
        {...(saveLabel ? { label: saveLabel } : {})}
        {...(saveIcon ? { icon: saveIcon } : {})}
      />
    </View>
  );
}
