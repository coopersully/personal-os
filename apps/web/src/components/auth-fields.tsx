import {
  emailAddressSchema,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordRequirementState,
  passwordSchema,
} from "@personal-os/domain";
import { REGEXP_ONLY_DIGITS_AND_CHARS } from "input-otp";
import { CheckCircle2, Circle, Eye, EyeOff } from "lucide-react";
import { type ComponentProps, type ReactNode, useId, useMemo, useState } from "react";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp";

export function isValidEmailAddress(value: string): boolean {
  return emailAddressSchema.safeParse(value).success;
}

export function isValidPassword(value: string): boolean {
  return passwordSchema.safeParse(value).success;
}

type TextFieldProps = Omit<ComponentProps<"input">, "type"> & {
  error?: string | undefined;
  label: string;
  type?: "email" | "text";
};

export function TextField({ error, id, label, type = "text", ...props }: TextFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
      <Input
        {...props}
        aria-invalid={Boolean(error)}
        autoCapitalize="none"
        autoCorrect="off"
        className="h-11"
        id={fieldId}
        type={type}
      />
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  );
}

type EmailFieldProps = Omit<TextFieldProps, "label" | "type"> & {
  label?: string;
};

export function EmailField({
  label = "Email",
  placeholder = "sam@example.com",
  ...props
}: EmailFieldProps) {
  return (
    <TextField
      {...props}
      autoCapitalize="none"
      autoCorrect="off"
      inputMode="email"
      label={label}
      placeholder={placeholder}
      spellCheck={false}
      type="email"
    />
  );
}

type InviteCodeFieldProps = {
  error?: string | undefined;
  onBlur?: () => void;
  onChange: (value: string) => void;
  status?: "checking" | "idle" | "valid";
  value: string;
};

export function InviteCodeField({
  error,
  onBlur,
  onChange,
  status = "idle",
  value,
}: InviteCodeFieldProps) {
  const fieldId = useId();
  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={fieldId}>Invite code</FieldLabel>
      <InputOTP
        aria-invalid={Boolean(error)}
        autoComplete="one-time-code"
        containerClassName="w-full"
        id={fieldId}
        maxLength={8}
        name="inviteCode"
        onBlur={onBlur}
        onChange={(nextValue) => onChange(nextValue.toUpperCase())}
        pattern={REGEXP_ONLY_DIGITS_AND_CHARS}
        pushPasswordManagerStrategy="none"
        required
        value={value}
      >
        <InputOTPGroup>
          {[0, 1, 2, 3].map((index) => (
            <InputOTPSlot aria-invalid={Boolean(error)} index={index} key={index} />
          ))}
        </InputOTPGroup>
        <InputOTPSeparator />
        <InputOTPGroup>
          {[4, 5, 6, 7].map((index) => (
            <InputOTPSlot aria-invalid={Boolean(error)} index={index} key={index} />
          ))}
        </InputOTPGroup>
      </InputOTP>
      {status === "checking" ? (
        <FieldDescription role="status">Checking invitation…</FieldDescription>
      ) : null}
      {status === "valid" ? (
        <FieldDescription className="text-success" role="status">
          Invitation accepted.
        </FieldDescription>
      ) : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  );
}

const passwordRequirements = [
  { key: "length", label: `${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters` },
  { key: "mixedCase", label: "Uppercase and lowercase letters" },
  { key: "number", label: "At least one number" },
  { key: "symbol", label: "At least one symbol" },
] as const;

function PasswordRequirementList({ password }: { password: string }) {
  const state = useMemo(() => passwordRequirementState(password), [password]);
  return (
    <ul aria-label="Password requirements" className="flex flex-col gap-1.5">
      {passwordRequirements.map(({ key, label }) => {
        const complete = state[key];
        const Icon = complete ? CheckCircle2 : Circle;
        return (
          <li
            className="flex items-center gap-2 text-sm text-muted-foreground data-[complete=true]:text-foreground"
            data-complete={complete}
            key={key}
          >
            <Icon aria-hidden="true" className="size-4" />
            <span>{label}</span>
            <span className="sr-only">{complete ? "satisfied" : "not yet satisfied"}</span>
          </li>
        );
      })}
    </ul>
  );
}

type PasswordFieldsProps = {
  autoComplete?: "current-password" | "new-password";
  confirmLabel?: string;
  confirmName?: string;
  confirmValue?: string | undefined;
  disabled?: boolean;
  error?: string | undefined;
  label?: string;
  labelAction?: ReactNode | undefined;
  name?: string;
  onConfirmValueChange?: (value: string) => void;
  onValueChange: (value: string) => void;
  placeholder?: string;
  showRequirements?: boolean;
  value: string;
};

export function PasswordFields({
  autoComplete = "new-password",
  confirmLabel = "Confirm password",
  confirmName = "confirmPassword",
  confirmValue,
  disabled,
  error,
  label = "Password",
  labelAction,
  name = "password",
  onConfirmValueChange,
  onValueChange,
  placeholder,
  showRequirements = false,
  value,
}: PasswordFieldsProps) {
  const passwordId = useId();
  const confirmationId = useId();
  const [visible, setVisible] = useState(false);
  const hasConfirmation = confirmValue !== undefined && onConfirmValueChange !== undefined;
  const visibilityLabel = visible
    ? `Hide password${hasConfirmation ? "s" : ""}`
    : `Show password${hasConfirmation ? "s" : ""}`;

  const renderVisibilityToggle = () => (
    <InputGroupAddon align="inline-end">
      <InputGroupButton
        aria-label={visibilityLabel}
        onClick={() => setVisible((current) => !current)}
        size="icon-xs"
        title={visibilityLabel}
      >
        {visible ? <EyeOff /> : <Eye />}
      </InputGroupButton>
    </InputGroupAddon>
  );

  return (
    <>
      <Field data-invalid={Boolean(error)}>
        <div className="flex items-center justify-between gap-3">
          <FieldLabel htmlFor={passwordId}>{label}</FieldLabel>
          {labelAction}
        </div>
        <InputGroup className="h-11">
          <InputGroupInput
            aria-invalid={Boolean(error)}
            autoComplete={autoComplete}
            disabled={disabled}
            id={passwordId}
            maxLength={PASSWORD_MAX_LENGTH}
            minLength={autoComplete === "new-password" ? PASSWORD_MIN_LENGTH : undefined}
            name={name}
            onChange={(event) => onValueChange(event.target.value)}
            placeholder={
              placeholder ??
              (autoComplete === "current-password" ? "Enter your password" : "Create a password")
            }
            required
            type={visible ? "text" : "password"}
            value={value}
          />
          {renderVisibilityToggle()}
        </InputGroup>
        {showRequirements ? <PasswordRequirementList password={value} /> : null}
        {error ? <FieldError>{error}</FieldError> : null}
      </Field>
      {hasConfirmation ? (
        <Field data-invalid={Boolean(error)}>
          <FieldLabel htmlFor={confirmationId}>{confirmLabel}</FieldLabel>
          <InputGroup className="h-11">
            <InputGroupInput
              aria-invalid={Boolean(error)}
              autoComplete="new-password"
              disabled={disabled}
              id={confirmationId}
              maxLength={PASSWORD_MAX_LENGTH}
              minLength={PASSWORD_MIN_LENGTH}
              name={confirmName}
              onChange={(event) => onConfirmValueChange(event.target.value)}
              placeholder="Enter the same password"
              required
              type={visible ? "text" : "password"}
              value={confirmValue}
            />
            {renderVisibilityToggle()}
          </InputGroup>
        </Field>
      ) : null}
    </>
  );
}
