import { ApiClientError } from "@personal-os/api-client";

export type FeedbackOptions = {
  action: string;
  success?: string;
  pending?: string;
  successDescription?: string;
  form?: boolean;
  safeToRetry?: boolean;
};

export type MutationFeedbackState = {
  kind: "validation" | "access" | "conflict" | "unsaved" | "uncertain" | "retryable";
  message: string;
  persistent: boolean;
  fields: Record<string, string>;
};

// These are explicit domain errors from auth-service, calendar-service and task-service.
// Never display an arbitrary server exception or Zod message.
const knownCorrections: Record<string, { field: string; message: string }> = {
  "Event end must be after its start": {
    field: "endsAt",
    message: "End time must be after start time.",
  },
  "Event end must be after its start.": {
    field: "endsAt",
    message: "End time must be after start time.",
  },
  "Pinterest could not resolve that public board and its images. Check that the board exists and is public.":
    {
      field: "boardUrl",
      message:
        "Check that this Pinterest board exists and is public. Your saved board and wallpaper have not changed.",
    },
  "Workday end must be after the start.": {
    field: "workdayEndMinute",
    message: "Workday end must be after workday start.",
  },
  "A scheduled task requires a scheduled time.": {
    field: "scheduledAt",
    message: "Choose a scheduled time for this task.",
  },
  "That email address is already used by another account.": {
    field: "email",
    message: "That email address is already in use. Enter another email address.",
  },
  "An account with this email already exists.": {
    field: "email",
    message: "That email address is already in use. Sign in or enter another email address.",
  },
};
function validationFields(details: unknown): Record<string, string> {
  const fields: Record<string, string> = {};
  if (!Array.isArray(details)) return fields;
  for (const issue of details) {
    if (!issue || !Array.isArray(issue.path) || !issue.path.length) continue;
    const path = issue.path.join(".");
    const correction =
      typeof issue.message === "string" && Object.hasOwn(knownCorrections, issue.message)
        ? knownCorrections[issue.message]
        : undefined;
    const bound = issue.code === "too_small" ? issue.minimum : issue.maximum;
    const hasBound = typeof bound === "number" && Number.isFinite(bound);
    fields[path] =
      correction?.message ??
      (issue.format === "email"
        ? "Enter an email address in the format name@example.com."
        : issue.code === "too_small"
          ? hasBound
            ? `Enter ${issue.origin === "string" ? `at least ${bound} characters` : `a value ${issue.inclusive === false ? "greater than" : "of at least"} ${bound}`}.`
            : "Enter a longer or larger value."
          : issue.code === "too_big"
            ? hasBound
              ? `Enter ${issue.origin === "string" ? `no more than ${bound} characters` : `a value ${issue.inclusive === false ? "less than" : "no greater than"} ${bound}`}.`
              : "Enter a shorter or smaller value."
            : "Check this value and enter a valid value.");
  }
  return fields;
}

export function classifyMutationError(
  error: unknown,
  options: FeedbackOptions,
): MutationFeedbackState {
  const base = { fields: {}, persistent: true };
  if (error instanceof ApiClientError) {
    if (
      error.status === 409 &&
      error.details &&
      typeof error.details === "object" &&
      "code" in error.details
    ) {
      const nameCorrections: Record<string, string> = {
        task_list_reserved_name: "That name is reserved for a Task view. Choose another name.",
        task_list_name_conflict: "A list with that name already exists. Choose another name.",
      };
      const code = error.details.code;
      const message =
        typeof code === "string" && Object.hasOwn(nameCorrections, code)
          ? nameCorrections[code]
          : undefined;
      if (message) {
        return { ...base, kind: "validation", fields: { name: message }, message };
      }
    }
    const correction = Object.hasOwn(knownCorrections, error.message)
      ? knownCorrections[error.message]
      : undefined;
    if (correction && (error.status === 400 || error.status === 409))
      return {
        ...base,
        kind: "validation",
        fields: { [correction.field]: correction.message },
        message: correction.message,
      };
    if (error.status === 401 && error.message === "The email or password is incorrect.")
      return {
        ...base,
        kind: "validation",
        message: "Check your email address and password, then try again.",
      };
    if (
      error.code === "invalid_request" &&
      error.message === "This link is invalid or has expired."
    )
      return {
        ...base,
        kind: "access",
        message: "This link has expired or is invalid. Request a new link and try again.",
      };
    const statusCode: Record<number, string> = {
      401: "unauthorized",
      403: "forbidden",
      409: "conflict",
      429: "rate_limited",
    };
    switch (statusCode[error.status] ?? error.code) {
      case "invalid_request":
        return {
          ...base,
          kind: "validation",
          fields: validationFields(error.details),
          message: `Couldn’t ${options.action}. Check the entered values and try again.`,
        };
      case "unauthorized":
        return {
          ...base,
          kind: "access",
          message:
            `Sign in again to ${options.action}. ${options.form ? "Your entered values are still here." : ""}`.trim(),
        };
      case "forbidden":
        return {
          ...base,
          kind: "access",
          message: `You don’t have access to ${options.action}. Check your account permissions or connection.`,
        };
      case "conflict":
      case "not_found":
        return {
          ...base,
          kind: "conflict",
          message: `Couldn’t ${options.action}. This item changed or is no longer available. Check the latest version before trying again.`,
        };
      case "rate_limited":
        return {
          ...base,
          persistent: Boolean(options.form),
          kind: options.form ? "unsaved" : "retryable",
          message: `Couldn’t ${options.action}. Too many attempts. Wait a little before trying again.`,
        };
    }
  }
  if (!options.safeToRetry) {
    return {
      ...base,
      kind: "uncertain",
      message: `Couldn’t confirm whether we could ${options.action}. Check the latest state before trying again to avoid making the change twice.`,
    };
  }
  return {
    ...base,
    kind: options.form ? "unsaved" : "retryable",
    persistent: Boolean(options.form),
    message: `Couldn’t ${options.action}.${options.form ? " Your changes are still unsaved." : ""} Try again.`,
  };
}
