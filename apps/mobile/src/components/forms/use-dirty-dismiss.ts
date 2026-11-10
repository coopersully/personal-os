import { usePreventRemove } from "expo-router";
import { useState } from "react";
import { Alert } from "react-native";
/** Protect both native Back and interactive dismissal, including pending writes. */
export function useDirtyDismiss(dirty: boolean, pending: boolean) {
  const [leaving, setLeaving] = useState(false);
  const disable = usePreventRemove(!leaving && (dirty || pending), ({ repeat }) => {
    if (pending) return;
    Alert.alert("Discard changes?", "Your unsaved changes will be lost.", [
      { text: "Keep editing", style: "cancel" },
      {
        text: "Discard",
        style: "destructive",
        onPress: () => {
          setLeaving(true);
          repeat();
        },
      },
    ]);
  });
  return () => {
    setLeaving(true);
    disable();
  };
}
