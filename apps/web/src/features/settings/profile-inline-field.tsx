import { type ReactNode, useCallback, useRef, useState } from "react";
import { FeedbackForm } from "@/components/feedback-form";
import { Field, FieldLabel } from "@/components/settings-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFeedbackMutation } from "@/lib/use-feedback-mutation";

/** Simple settings stay in their row; complex decisions use a separate editor. */
export function ProfileInlineField({
  id,
  label,
  value,
  displayValue,
  type = "text",
  required = false,
  autoComplete,
  fieldName = id,
  validate,
  save,
  children,
}: {
  id: string;
  label: string;
  value: string;
  displayValue?: string;
  type?: "text" | "email" | "time";
  required?: boolean;
  autoComplete?: string;
  fieldName?: string;
  validate?: (value: string) => string | undefined;
  save: (value: string) => Promise<unknown>;
  children?: ReactNode;
}) {
  const [editing, setEditing] = useState(type === "time");
  const [draft, setDraft] = useState(value);
  const submitting = useRef(false);
  const cancelled = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const focusInput = useCallback((node: HTMLInputElement | null) => node?.focus(), []);
  const finishEditing = () => {
    const restoreFocus = document.activeElement?.id === id;
    if (type !== "time") setEditing(false);
    if (restoreFocus && type !== "time") requestAnimationFrame(() => trigger.current?.focus());
  };
  const update = useFeedbackMutation({
    feedback: { action: `save your ${label.toLowerCase()}`, form: true },
    mutationFn: save,
    onSuccess: finishEditing,
    onSettled: () => {
      submitting.current = false;
    },
  });
  return (
    <FeedbackForm
      className="settings-inline-row px-4 py-0"
      feedback={update.feedback}
      fieldNames={{ [fieldName]: id }}
      validate={() => {
        const error = validate?.(draft.trim());
        return error ? { [id]: error } : {};
      }}
      onBlur={(event) => {
        if (editing && !cancelled.current && !event.currentTarget.contains(event.relatedTarget)) {
          event.currentTarget.requestSubmit();
        }
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (cancelled.current || submitting.current) return;
        const next = draft.trim();
        if (next === value) {
          finishEditing();
          return;
        }
        submitting.current = true;
        update.mutate(next);
      }}
    >
      <Field orientation="horizontal" className="min-h-10 justify-between">
        <FieldLabel htmlFor={editing ? id : undefined} className="shrink-0">
          {label}
        </FieldLabel>
        {editing ? (
          <Input
            ref={type === "time" ? undefined : focusInput}
            id={id}
            name={id}
            aria-label={label}
            type={type}
            autoComplete={autoComplete}
            required={required}
            readOnly={update.isPending}
            value={draft}
            className="settings-inline-input"
            onClick={(event) => {
              if (type === "time") {
                try {
                  event.currentTarget.showPicker?.();
                } catch {
                  /* Native keyboard editing remains available. */
                }
              }
            }}
            onChange={(event) => {
              cancelled.current = false;
              setDraft(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !update.isPending) {
                event.preventDefault();
                cancelled.current = true;
                update.reset();
                setDraft(value);
                if (type !== "time") setEditing(false);
                requestAnimationFrame(() => trigger.current?.focus());
              }
            }}
          />
        ) : (
          <Button
            ref={trigger}
            type="button"
            variant="ghost"
            aria-label={`Edit ${label}`}
            className="max-w-[65%] justify-end font-normal text-muted-foreground"
            onClick={() => {
              cancelled.current = false;
              update.reset();
              setDraft(value);
              setEditing(true);
            }}
          >
            <span className="truncate">{displayValue ?? (value || "Not set")}</span>
          </Button>
        )}
      </Field>
      {children}
    </FeedbackForm>
  );
}
