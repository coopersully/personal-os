import { GlassButton } from "./glass-button";

/**
 * The standard leading dismissal (Close, Cancel, Back or Done) for sheet chrome and for
 * platforms without native bar items. Stack headers on iOS use `editorDismissOptions`.
 */
export function EditorClose({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return <GlassButton label={label} onPress={onPress} disabled={disabled} />;
}
