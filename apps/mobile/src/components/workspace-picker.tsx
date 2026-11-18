import type { IconName } from "./icons";
export interface WorkspacePickerProps {
  selected: string | null;
  options: readonly { id: string; label: string; icon: IconName }[];
}
// The web header retains its existing pointer-accessible dropdown.
export function WorkspacePicker(_props: WorkspacePickerProps) {
  return null;
}
