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
  controlWidth,
  ...props
}: ComponentProps<typeof BaseField> & { layout?: "row" | "stack"; controlWidth?: "compact" }) {
  const settings = useContext(SettingsControlsContext);
  return (
    <BaseField
      {...props}
      style={
        controlWidth === "compact"
          ? { ...props.style, display: "flex", flexDirection: "row", alignItems: "center" }
          : props.style
      }
      data-settings-row={settings && layout === "row" ? "" : undefined}
      data-settings-control-width={controlWidth}
    />
  );
}

/** An effective/read-only value is content, never a disabled imitation input. */
export function SettingsValue(props: ComponentProps<"span">) {
  return <span {...props} data-slot="settings-value" />;
}
