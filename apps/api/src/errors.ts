import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

export type ErrorCode =
  | "conflict"
  | "feature_unavailable"
  | "forbidden"
  | "internal_error"
  | "invalid_request"
  | "not_found"
  | "rate_limited"
  | "service_unavailable"
  | "unauthorized";

const statuses = {
  conflict: 409,
  feature_unavailable: 410,
  forbidden: 403,
  internal_error: 500,
  invalid_request: 400,
  not_found: 404,
  rate_limited: 429,
  service_unavailable: 503,
  unauthorized: 401,
} as const;

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly details?: unknown;
  public readonly status: 400 | 401 | 403 | 404 | 409 | 410 | 429 | 500 | 503;

  public constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
    this.status = statuses[code];
  }
}

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  let current = error;
  const seen = new Set<unknown>();
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    if (
      "code" in current &&
      current.code === "23505" &&
      (constraint === undefined || ("constraint" in current && current.constraint === constraint))
    )
      return true;
    seen.add(current);
    current = "cause" in current ? current.cause : null;
  }
  return false;
}

export function errorResponse(error: Error, context: Context): Response {
  const requestId = context.get("requestId") as string;
  if (error instanceof AppError) {
    return context.json(
      {
        error: {
          code: error.code,
          message: error.message,
          requestId,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      },
      error.status,
    );
  }
  if (error instanceof ZodError) {
    return context.json(
      {
        error: {
          code: "invalid_request",
          details: error.issues,
          message: "The request did not match the expected shape.",
          requestId,
        },
      },
      400,
    );
  }
  if (error instanceof HTTPException) {
    return context.json(
      {
        error: {
          code: error.status === 404 ? "not_found" : "invalid_request",
          message: error.message,
          requestId,
        },
      },
      error.status,
    );
  }
  return context.json(
    {
      error: {
        code: "internal_error",
        message: "An unexpected error occurred.",
        requestId,
      },
    },
    500,
  );
}
