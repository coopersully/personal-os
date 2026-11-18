import { type ComponentProps, useContext } from "react";
import { SettingsControlsContext } from "./settings-controls-context";
import { Field as BaseField } from "./ui/field";

export {
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
} from "./ui/field";

/** Settings owns row geometry; editors and domain adapters still own behavior. */
export function Field({
  layout = "row",
  ...props
}: ComponentProps<typeof BaseField> & { layout?: "row" | "stack" }) {
  const settings = useContext(SettingsControlsContext);
  return <BaseField {...props} data-settings-row={settings && layout === "row" ? "" : undefined} />;
}

/** An effective/read-only value is content, never a disabled imitation input. */
export function SettingsValue(props: ComponentProps<"span">) {
  return <span {...props} data-slot="settings-value" />;
}
