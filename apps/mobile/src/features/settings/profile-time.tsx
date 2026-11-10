import { useEffect, useState } from "react";
import { Field } from "../tasks/ui";
export interface ProfileTimeProps {
  label: string;
  value: number;
  onChange: (minute: number) => void;
  end?: boolean;
  disabled?: boolean;
}
const format = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
export function ProfileTime({ label, value, onChange, end, disabled }: ProfileTimeProps) {
  const [text, setText] = useState(format(value));
  useEffect(() => {
    if (Number.isFinite(value)) setText(format(value));
  }, [value]);
  return (
    <Field
      label={label}
      icon="clock"
      editable={!disabled}
      value={text}
      placeholder="09:00"
      onChangeText={(text) => {
        setText(text);
        const match = /^(\d{1,2}):(\d{2})$/.exec(text);
        const minute = match ? Number(match[1]) * 60 + Number(match[2]) : Number.NaN;
        const valid =
          match &&
          Number(match[2]) < 60 &&
          minute >= (end ? 1 : 0) &&
          minute <= (end ? 1440 : 1439);
        onChange(valid ? minute : Number.NaN);
      }}
    />
  );
}
