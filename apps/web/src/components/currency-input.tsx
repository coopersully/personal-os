import { type ComponentProps, useEffect, useRef, useState } from "react";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";

const money = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const decimal = /^-?(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/;

type CurrencyInputProps = Omit<
  ComponentProps<"input">,
  "value" | "defaultValue" | "onChange" | "type" | "min" | "max" | "step"
> & {
  currencyCode?: string | null;
  value: string;
  onValueChange: (value: string) => void;
  min?: number;
  max?: number;
};

/** USD display formatting never changes the canonical decimal string saved by the form. */
export function CurrencyInput({
  value,
  currencyCode = "USD",
  onValueChange,
  name,
  min = 0,
  max,
  onFocus,
  onBlur,
  ...props
}: CurrencyInputProps) {
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const valid = decimal.test(value) && Number.isFinite(Number(value));
  const error =
    value === ""
      ? ""
      : !valid
        ? "Enter an amount with up to two decimal places."
        : Number(value) < min
          ? `Enter an amount of at least ${money.format(min)}.`
          : max !== undefined && Number(value) > max
            ? `Enter an amount no greater than ${money.format(max)}.`
            : "";
  useEffect(() => {
    input.current?.setCustomValidity(error);
  }, [error]);
  // Retain the visible field's name for FeedbackForm's server-error mapping.
  // Native form serialization receives the unformatted value, just like controlled saves.
  useEffect(() => {
    const form = input.current?.form;
    if (!form || !name || props.disabled) return;
    const serialize = (event: FormDataEvent) => {
      if (!input.current?.matches(":disabled")) event.formData.set(name, value);
    };
    form.addEventListener("formdata", serialize);
    return () => form.removeEventListener("formdata", serialize);
  }, [name, value, props.disabled]);
  return (
    <InputGroup data-disabled={props.disabled}>
      {currencyCode ? (
        <InputGroupAddon aria-hidden="true">
          {
            new Intl.NumberFormat("en-US", { style: "currency", currency: currencyCode })
              .formatToParts(0)
              .find((part) => part.type === "currency")?.value
          }
        </InputGroupAddon>
      ) : null}
      <InputGroupInput
        {...props}
        ref={input}
        name={name}
        type="text"
        inputMode="decimal"
        value={!focused && valid ? money.format(Number(value)) : value}
        onChange={(event) => onValueChange(event.target.value.replaceAll(",", ""))}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
      />
    </InputGroup>
  );
}
