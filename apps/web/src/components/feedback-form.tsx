import { type ComponentProps, useEffect, useId, useRef, useState } from "react";
import type { MutationFeedbackState } from "../lib/feedback.js";
import { MutationFeedback } from "./mutation-feedback.js";

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
type FieldError = { field: Field; message: string; source?: "server" };
function fields(form: HTMLFormElement): Field[] {
  return Array.from(form.elements).filter(
    (element): element is Field =>
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement,
  );
}
function inputName(path: string, names?: Record<string, string>): string {
  if (names?.[path]) return names[path];
  const prefix = Object.keys(names ?? {})
    .filter((name) => path.startsWith(`${name}.`))
    .sort((a, b) => b.length - a.length)[0];
  return prefix ? (names?.[prefix] ?? path) : path;
}
function fieldLabel(field: Field): string {
  const label = field.labels?.[0]?.cloneNode(true) as HTMLElement | undefined;
  for (const error of label?.querySelectorAll("[data-feedback-error]") ?? []) error.remove();
  return field.getAttribute("aria-label") || label?.textContent?.trim() || field.name || "Field";
}
function correction(field: Field): string {
  if (field.validity.valueMissing) return "Enter a value for this field.";
  if (field.validity.typeMismatch && field instanceof HTMLInputElement && field.type === "email")
    return "Enter an email address in the format name@example.com.";
  if (field.validity.rangeUnderflow)
    return `Enter a value of at least ${(field as HTMLInputElement).min}.`;
  if (field.validity.rangeOverflow)
    return `Enter a value no greater than ${(field as HTMLInputElement).max}.`;
  return field.validationMessage || "Check this value and try again.";
}

export function FeedbackForm({
  feedback,
  fieldNames,
  validate,
  children,
  onSubmit,
  onInput,
  onBlur,
  ref: forwardedRef,
  ...props
}: ComponentProps<"form"> & {
  feedback: MutationFeedbackState | null;
  fieldNames?: Record<string, string>;
  validate?: (form: HTMLFormElement) => Record<string, string>;
}) {
  const form = useRef<HTMLFormElement>(null);
  const summary = useRef<HTMLDivElement>(null);
  const id = useId();
  const focusRequested = useRef(false);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const names = useRef(fieldNames);
  names.current = fieldNames;

  useEffect(() => {
    if (!form.current) return;
    const inputs = fields(form.current);
    focusRequested.current = Object.keys(feedback?.fields ?? {}).length > 0;
    const mapped = new Map<Field, string[]>();
    for (const [name, message] of Object.entries(feedback?.fields ?? {})) {
      const field = inputs.find(
        (input) => input.willValidate && input.name === inputName(name, names.current),
      );
      if (field) mapped.set(field, [...(mapped.get(field) ?? []), message]);
    }
    setErrors(
      Array.from(mapped, ([field, messages]) => ({
        field,
        message: [...new Set(messages)].join(" "),
        source: "server",
      })),
    );
  }, [feedback]);

  // Controlled selections can change validity without a native input event.
  // Recheck only errors already shown, retaining unrelated server rejections.
  useEffect(() => {
    if (!validate || !form.current) return;
    const custom = validate(form.current);
    setErrors((current) => {
      const next = current.flatMap((error) => {
        if (error.source === "server") return [error];
        const message =
          custom[error.field.name] ??
          (!error.field.validity.valid ? correction(error.field) : null);
        return message ? [{ ...error, message }] : [];
      });
      return next.length === current.length &&
        next.every((error, index) => error.message === current[index]?.message)
        ? current
        : next;
    });
  }, [validate]);

  // Existing forms own their inputs. Scope associations and messages to those actual
  // controls, restoring original helper-text associations on correction/unmount.
  useEffect(() => {
    const cleanups = errors.map(({ field, message }, index) => {
      const description = field.getAttribute("aria-describedby");
      const invalid = field.getAttribute("aria-invalid");
      const error = document.createElement("span");
      error.id = `${id}-field-${index}`;
      error.className = "block text-sm text-destructive";
      error.dataset.feedbackError = "true";
      error.textContent = message;
      // Keep error text out of an implicit label’s accessible name.
      (field.closest("label") ?? field).insertAdjacentElement("afterend", error);
      field.setAttribute("aria-describedby", [description, error.id].filter(Boolean).join(" "));
      field.setAttribute("aria-invalid", "true");
      return () => {
        error.remove();
        if (description === null) field.removeAttribute("aria-describedby");
        else field.setAttribute("aria-describedby", description);
        if (invalid === null) field.removeAttribute("aria-invalid");
        else field.setAttribute("aria-invalid", invalid);
      };
    });
    if (focusRequested.current && errors.length > 0) {
      if (summary.current) summary.current.focus();
      else if (errors.length === 1) errors[0]?.field.focus();
      focusRequested.current = false;
    }
    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, [errors, id]);

  const serverFields = Object.entries(feedback?.fields ?? {});
  const unmappedErrors = serverFields.filter(
    ([name]) =>
      !form.current ||
      !fields(form.current).some(
        (field) => field.willValidate && field.name === inputName(name, fieldNames),
      ),
  );
  const hasMappedServerErrors = serverFields.length > unmappedErrors.length;
  const showSummary = errors.length > 1 || (errors.length > 0 && unmappedErrors.length > 0);

  return (
    <form
      {...props}
      ref={(element) => {
        form.current = element;
        if (typeof forwardedRef === "function") return forwardedRef(element);
        if (forwardedRef) forwardedRef.current = element;
      }}
      noValidate
      onInput={(event) => {
        onInput?.(event);
        const field = event.target;
        if (
          !(
            field instanceof HTMLInputElement ||
            field instanceof HTMLSelectElement ||
            field instanceof HTMLTextAreaElement
          )
        )
          return;
        const custom = validate?.(event.currentTarget) ?? {};
        setErrors((current) =>
          current.flatMap((error) => {
            if (error.source === "server" && error.field !== field) return [error];
            const customMessage = custom[error.field.name];
            if (customMessage) return [{ field: error.field, message: customMessage }];
            if (error.field !== field && !validate) return [error];
            return error.field.validity.valid
              ? []
              : [{ field: error.field, message: correction(error.field) }];
          }),
        );
      }}
      onBlur={(event) => {
        onBlur?.(event);
        const next = event.relatedTarget;
        // Inserting an error between pointerdown and click can move the submit
        // button out from under the pointer. Submission owns validation here.
        if (
          (next instanceof HTMLButtonElement || next instanceof HTMLInputElement) &&
          (next.type === "submit" || next.type === "image") &&
          next.form === event.currentTarget
        )
          return;
        const field = event.target;
        if (
          !(
            field instanceof HTMLInputElement ||
            field instanceof HTMLSelectElement ||
            field instanceof HTMLTextAreaElement
          )
        )
          return;
        if (
          !field.willValidate ||
          (!field.value.trim() && !errors.some((error) => error.field === field))
        )
          return;
        const message = validate?.(event.currentTarget)[field.name];
        if (message)
          setErrors((current) => [
            ...current.filter((error) => error.field !== field),
            { field, message },
          ]);
        else if (field.validity.valid)
          setErrors((current) =>
            current.filter((error) => error.field !== field || error.source === "server"),
          );
      }}
      onSubmit={(event) => {
        const custom = validate?.(event.currentTarget) ?? {};
        const invalid = fields(event.currentTarget).flatMap((field) => {
          if (!field.willValidate) return [];
          const message =
            custom[field.name] ??
            (field.willValidate && !field.validity.valid ? correction(field) : null);
          return message ? [{ field, message }] : [];
        });
        focusRequested.current = invalid.length > 0;
        setErrors(invalid);
        if (invalid.length) {
          event.preventDefault();
          return;
        }
        onSubmit?.(event);
      }}
    >
      {showSummary && (
        <div ref={summary} tabIndex={-1} className="text-sm text-destructive">
          <p>Check these fields before continuing.</p>
          <ul>
            {unmappedErrors.map(([name, message]) => (
              <li key={name}>{message}</li>
            ))}
            {errors.map(({ field, message }) => (
              <li key={field.name || field.id}>
                <button type="button" className="underline" onClick={() => field.focus()}>
                  {fieldLabel(field)}: {message}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {children}
      {!showSummary && unmappedErrors.length > 0 && (
        <div role="status" className="text-sm text-destructive">
          {unmappedErrors.map(([name, message]) => (
            <p key={name}>{message}</p>
          ))}
        </div>
      )}
      {errors.length === 0 && !hasMappedServerErrors && unmappedErrors.length === 0 && (
        <MutationFeedback feedback={feedback} />
      )}
    </form>
  );
}
