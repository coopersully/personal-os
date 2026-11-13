import { spacing } from "../../theme";

/**
 * The one row geometry for forms and settings: 56 points minimum, 16-point side padding,
 * 12-point vertical padding and gaps, contents vertically centered. Every label/value,
 * toggle, picker, navigation and action row uses it, so no screen owns its own padding.
 */
export const formRow = {
  minHeight: 56,
  paddingHorizontal: spacing.lg,
  paddingVertical: spacing.md,
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.md,
} as const;
