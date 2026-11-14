import { Platform } from "react-native";
import { EditorClose } from "./editor-close";
import { icons } from "./icons";
import type { RowAction } from "./row-action-button";
import { RowActions } from "./row-actions";

/** The theme colors a header action may take; pass the screen's `useTheme()` value. */
type ActionTheme = { destructive: string };
type StackTheme = { dark: boolean; ink: string; canvas: string };

/**
 * The one set of screen options for every native stack. The bar's interface style follows
 * the app theme, so its glass controls and their labels match in light and dark on every
 * stack; a stack that omits it draws light glass under a dark theme.
 */
export function stackChromeOptions(theme: StackTheme) {
  return {
    headerTintColor: theme.ink,
    statusBarStyle: theme.dark ? ("light" as const) : ("dark" as const),
    headerUserInterfaceStyle: theme.dark ? ("dark" as const) : ("light" as const),
    headerStyle: { backgroundColor: theme.canvas },
    contentStyle: { backgroundColor: theme.canvas },
    headerShadowVisible: false,
    headerBackButtonDisplayMode: "minimal" as const,
  };
}
type DismissAction = { label: string; onPress: () => void; disabled?: boolean };

/**
 * The one way a stack screen declares its leading Close, Cancel, Back or Done.
 *
 * On iOS the control is a native bar item: UIKit owns its glass, intrinsic label width,
 * Dynamic Type and disabled appearance, and keeps the title centered. Never pass a custom
 * view as `headerLeft` on iOS; the bar wraps it in a second glass capsule sized for an icon.
 */
export function editorDismissOptions(action: DismissAction) {
  return {
    headerLeft: () => <EditorClose {...action} />,
    ...(Platform.OS === "ios" && {
      unstable_headerLeftItems: () => [{ type: "button" as const, ...action }],
    }),
  };
}

/**
 * The trailing record actions of a stack screen: nothing for no actions (never an empty
 * glass circle), one native icon button for one action, and the shared ellipsis menu for
 * several. The menu stays a hosted control because its semantic-color glyphs are not
 * template images a native bar menu could tint. A destructive action stays red in every
 * form, so the theme is required rather than optional.
 */
export function editorActionsOptions(
  label: string,
  actions: readonly RowAction[],
  theme: ActionTheme,
) {
  const [only] = actions;
  if (!only)
    return {
      headerRight: undefined,
      ...(Platform.OS === "ios" && { unstable_headerRightItems: undefined }),
    };
  if (actions.length === 1) return editorActionOptions(only, theme);
  return {
    headerRight: () => <RowActions placement="header" label={label} actions={actions} />,
    ...(Platform.OS === "ios" && { unstable_headerRightItems: undefined }),
  };
}

/** Single header actions use the same native bar-item sizing and material as dismissal. */
export function editorActionOptions(action: RowAction, theme: ActionTheme) {
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
          ...(action.destructive && { tintColor: theme.destructive }),
          onPress: action.onPress,
        },
      ],
    }),
  };
}
