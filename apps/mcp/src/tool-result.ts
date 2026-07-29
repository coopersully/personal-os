import { ApiClientError } from "@personal-os/api-client";

/** Consistent, typed MCP result envelopes shared by feature-owned tool modules. */
export function result(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: { result: value },
  };
}

export function emptyResult(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    structuredContent: { ok: true },
  };
}

/**
 * Preserve the authenticated API's structured failure contract at the MCP boundary.
 * Tool annotations are only hints; callers need the API code and repair details to
 * respond safely when an external mutation may already have committed.
 */
export async function apiResult(operation: () => Promise<unknown>) {
  try {
    return result(await operation());
  } catch (error) {
    if (!(error instanceof ApiClientError)) throw error;
    const value = {
      code: error.code,
      details: error.details,
      message: error.message,
      requestId: error.requestId,
      status: error.status,
    };
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: value }, null, 2) }],
      isError: true,
      structuredContent: { error: value },
    };
  }
}
