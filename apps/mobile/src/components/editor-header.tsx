import { Platform } from "react-native";
import { EditorClose } from "./editor-close";

type DismissAction = { label: string; onPress: () => void; disabled?: boolean };
/** UIKit owns intrinsic label sizing, glass, Dynamic Type and disabled appearance. */
export function editorDismissOptions(action: DismissAction) {
  return {
    headerLeft: () => <EditorClose {...action} />,
    ...(Platform.OS === "ios" && {
      unstable_headerLeftItems: () => [{ type: "button" as const, ...action }],
    }),
  };
}

import { icons } from "./icons";
import type { RowAction } from "./row-action-button";
import { RowActions } from "./row-actions";
/** Single header actions use the same native bar-item sizing and material as dismissal. */
export function editorActionOptions(action: RowAction) {
  return {
    headerRight: () => <RowActions placement="header" label={action.label} actions={[action]} />,
    ...(Platform.OS === "ios" && {
      unstable_headerRightItems: () => [
        {
          type: "button" as const,
          label: action.label,
          accessibilityLabel: action.label,
          icon: { type: "image" as const, source: icons[action.icon] },
          disabled: action.disabled,
          onPress: action.onPress,
        },
      ],
    }),
  };
}
