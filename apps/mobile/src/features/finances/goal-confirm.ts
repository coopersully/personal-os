import { Alert, Platform } from "react-native";

/**
 * Asks before a goal change or before discarding a draft. The browser build's `Alert` does
 * nothing, so the browser's own confirmation asks there.
 */
export function confirmChoice(choice: {
  title: string;
  message: string;
  cancel: string;
  accept: string;
  destructive?: boolean;
  onAccept: () => void;
}) {
  if (Platform.OS === "web") {
    if (globalThis.confirm(`${choice.title}\n\n${choice.message}`)) choice.onAccept();
    return;
  }
  Alert.alert(choice.title, choice.message, [
    { text: choice.cancel, style: "cancel" },
    {
      text: choice.accept,
      style: choice.destructive ? "destructive" : "default",
      onPress: choice.onAccept,
    },
  ]);
}
