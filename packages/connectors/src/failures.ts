export type ConnectorFailureCategory =
  | "authorization"
  | "configuration"
  | "invalid_response"
  | "not_found"
  | "rate_limited"
  | "rejected"
  | "temporary"
  | "transport"
  | "unknown";

export type ConnectorFailureDisposition = "operator" | "reconnect" | "retry";

export class ConnectorError extends Error {
  public readonly category: ConnectorFailureCategory;
  public readonly code: string;
  public readonly disposition: ConnectorFailureDisposition;
  public readonly retryAfterMs: number | null;
  public readonly status: number | null;

  public constructor(input: {
    category: ConnectorFailureCategory;
    code: string;
    disposition: ConnectorFailureDisposition;
    message: string;
    retryAfterMs?: number;
    status?: number;
  }) {
    super(input.message);
    this.name = "ConnectorError";
    this.category = input.category;
    this.code = input.code;
    this.disposition = input.disposition;
    this.retryAfterMs = input.retryAfterMs ?? null;
    this.status = input.status ?? null;
  }
}

export async function connectorHttpError(
  response: Response,
  provider: "google" | "plaid" | "x",
): Promise<ConnectorError> {
  const retryAfterMs = retryAfter(response.headers.get("retry-after"));
  const safeProviderError =
    provider === "google"
      ? await readGoogleOAuthErrorCode(response)
      : provider === "plaid"
        ? await readPlaidErrorCode(response)
        : null;
  if (safeProviderError === null) {
    await response.body?.cancel().catch(() => undefined);
  }
  const label = provider === "google" ? "Google" : provider === "plaid" ? "Plaid" : "X";
  const prefix = provider;
  if (provider === "plaid" && safeProviderError === "INVALID_API_KEYS") {
    return new ConnectorError({
      category: "configuration",
      code: "plaid_configuration_invalid",
      disposition: "operator",
      message: "Plaid is not configured correctly.",
      status: response.status,
    });
  }
  if (provider === "plaid" && safeProviderError === "ITEM_LOGIN_REQUIRED") {
    return new ConnectorError({
      category: "authorization",
      code: "plaid_authorization_failed",
      disposition: "reconnect",
      message: "Plaid authorization is no longer valid.",
      status: response.status,
    });
  }
  if (provider === "plaid" && safeProviderError === "RATE_LIMIT_EXCEEDED") {
    return new ConnectorError({
      category: "rate_limited",
      code: "plaid_rate_limited",
      disposition: "retry",
      message: "Plaid is temporarily rate-limiting nohmi.",
      ...(retryAfterMs === null ? {} : { retryAfterMs }),
      status: response.status,
    });
  }
  if (safeProviderError === "invalid_grant") {
    return new ConnectorError({
      category: "authorization",
      code: "google_authorization_failed",
      disposition: "reconnect",
      message: "Google authorization is no longer valid.",
      status: response.status,
    });
  }
  if (
    safeProviderError === "invalid_client" ||
    safeProviderError === "unauthorized_client" ||
    safeProviderError === "redirect_uri_mismatch"
  ) {
    return new ConnectorError({
      category: "configuration",
      code: "google_configuration_invalid",
      disposition: "operator",
      message: "Google is not configured correctly.",
      status: response.status,
    });
  }
  if (response.status === 401 || response.status === 403) {
    return new ConnectorError({
      category: "authorization",
      code: `${prefix}_authorization_failed`,
      disposition: "reconnect",
      message: `${label} authorization is no longer valid.`,
      status: response.status,
    });
  }
  if (response.status === 404) {
    return new ConnectorError({
      category: "not_found",
      code: `${prefix}_resource_not_found`,
      disposition: "operator",
      message: `${label} could not find the requested resource.`,
      status: response.status,
    });
  }
  if (response.status === 429) {
    return new ConnectorError({
      category: "rate_limited",
      code: `${prefix}_rate_limited`,
      disposition: "retry",
      message: `${label} is temporarily rate-limiting nohmi.`,
      ...(retryAfterMs === null ? {} : { retryAfterMs }),
      status: response.status,
    });
  }
  if (response.status === 408 || response.status >= 500) {
    return new ConnectorError({
      category: "temporary",
      code: `${prefix}_temporary_failure`,
      disposition: "retry",
      message: `${label} is temporarily unavailable.`,
      status: response.status,
    });
  }
  return new ConnectorError({
    category: "rejected",
    code: `${prefix}_request_rejected`,
    disposition: "operator",
    message: `${label} rejected the request.`,
    status: response.status,
  });
}

export function classifyICloudError(service: "calendar" | "mail", error: unknown): ConnectorError {
  if (error instanceof ConnectorError) return error;
  const details = objectDetails(error);
  const code = typeof details?.code === "string" ? details.code.toUpperCase() : null;
  const responseStatus =
    typeof details?.responseStatus === "string" ? details.responseStatus.toUpperCase() : null;
  const status =
    typeof details?.status === "number"
      ? details.status
      : typeof details?.statusCode === "number"
        ? details.statusCode
        : null;
  const authenticationFailed =
    details?.authenticationFailed === true ||
    status === 401 ||
    status === 403 ||
    responseStatus === "AUTHENTICATIONFAILED" ||
    code === "AUTHENTICATIONFAILED" ||
    code === "AUTH_FAILED" ||
    code === "EAUTH";
  const label = service === "calendar" ? "Calendar" : "Mail";
  if (authenticationFailed) {
    return new ConnectorError({
      category: "authorization",
      code: `icloud_${service}_authorization_failed`,
      disposition: "reconnect",
      message: `iCloud ${label} authorization is no longer valid.`,
      ...(status === null ? {} : { status }),
    });
  }
  return new ConnectorError({
    category: "transport",
    code: `icloud_${service}_transport_failure`,
    disposition: "retry",
    message: `iCloud ${label} is temporarily unavailable.`,
    ...(status === null ? {} : { status }),
  });
}

const MAX_RETRY_AFTER_MS = 86_400_000;
const MAX_PROVIDER_ERROR_BODY_BYTES = 4_096;

type GoogleOAuthErrorCode =
  | "invalid_client"
  | "invalid_grant"
  | "redirect_uri_mismatch"
  | "unauthorized_client";
type PlaidErrorCode = "INVALID_API_KEYS" | "ITEM_LOGIN_REQUIRED" | "RATE_LIMIT_EXCEEDED";

async function readGoogleOAuthErrorCode(response: Response): Promise<GoogleOAuthErrorCode | null> {
  if (
    response.status !== 400 ||
    !response.headers.get("content-type")?.toLowerCase().includes("application/json") ||
    !response.body
  ) {
    return null;
  }

  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  const decoder = new TextDecoder();
  let serialized = "";
  let bytes = 0;
  try {
    reader = response.body.getReader();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_PROVIDER_ERROR_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      serialized += decoder.decode(chunk.value, { stream: true });
    }
    serialized += decoder.decode();
  } catch {
    await reader?.cancel().catch(() => undefined);
    return null;
  }

  try {
    const parsed = JSON.parse(serialized) as unknown;
    const error = objectDetails(parsed)?.error;
    if (
      error === "invalid_client" ||
      error === "invalid_grant" ||
      error === "redirect_uri_mismatch" ||
      error === "unauthorized_client"
    ) {
      return error;
    }
  } catch {
    return null;
  }
  return null;
}

async function readPlaidErrorCode(response: Response): Promise<PlaidErrorCode | null> {
  if (
    !response.headers.get("content-type")?.toLowerCase().includes("application/json") ||
    !response.body
  ) {
    return null;
  }

  const serialized = await readBoundedProviderBody(response);
  if (serialized === null) return null;
  try {
    const errorCode = objectDetails(JSON.parse(serialized))?.error_code;
    return errorCode === "INVALID_API_KEYS" ||
      errorCode === "ITEM_LOGIN_REQUIRED" ||
      errorCode === "RATE_LIMIT_EXCEEDED"
      ? errorCode
      : null;
  } catch {
    return null;
  }
}

async function readBoundedProviderBody(response: Response): Promise<string | null> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  const decoder = new TextDecoder();
  let serialized = "";
  let bytes = 0;
  try {
    reader = response.body?.getReader() ?? null;
    if (!reader) return null;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_PROVIDER_ERROR_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      serialized += decoder.decode(chunk.value, { stream: true });
    }
    return serialized + decoder.decode();
  } catch {
    await reader?.cancel().catch(() => undefined);
    return null;
  }
}

function retryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.round(seconds * 1_000), MAX_RETRY_AFTER_MS);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.min(Math.max(0, timestamp - Date.now()), MAX_RETRY_AFTER_MS);
}

function objectDetails(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}
