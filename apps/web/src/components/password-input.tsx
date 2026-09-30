import { type ComponentProps, useState } from "react";
import { EyeIcon, EyeOffIcon } from "@/components/icons";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";

export function PasswordInput({ disabled, type: _type, ...props }: ComponentProps<"input">) {
  const [visible, setVisible] = useState(false);

  return (
    <InputGroup data-disabled={disabled || undefined}>
      <InputGroupInput {...props} disabled={disabled} type={visible ? "text" : "password"} />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          disabled={disabled}
          onClick={() => setVisible((current) => !current)}
          size="icon-xs"
        >
          {visible ? <EyeOffIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}
