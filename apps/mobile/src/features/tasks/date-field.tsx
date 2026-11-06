import { Field } from "./ui";
export interface DateFieldProps {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  dateOnly?: boolean;
}
export function DateField({ label, value, onChange }: DateFieldProps) {
  return (
    <Field
      label={`${label} (ISO date/time)`}
      value={value ?? ""}
      onChangeText={(text) => onChange(text || null)}
      placeholder="No date"
    />
  );
}
