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

// Only runtime-owned codes cross the logging boundary. Never inspect exception text,
// hostnames, addresses, URLs, stacks, or provider response bodies.
const transportPhases = {
  ENOTFOUND: "dns",
  EAI_AGAIN: "dns",
  EAI_FAIL: "dns",
  CERT_HAS_EXPIRED: "tls",
  CERT_NOT_YET_VALID: "tls",
  DEPTH_ZERO_SELF_SIGNED_CERT: "tls",
  SELF_SIGNED_CERT_IN_CHAIN: "tls",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "tls",
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: "tls",
  ERR_TLS_CERT_ALTNAME_INVALID: "tls",
  ERR_SSL_WRONG_VERSION_NUMBER: "tls",
  ECONNRESET: "socket",
  ECONNREFUSED: "socket",
  EPIPE: "socket",
  ENETUNREACH: "socket",
  EHOSTUNREACH: "socket",
  UND_ERR_SOCKET: "socket",
  ETIMEDOUT: "timeout",
  ESOCKETTIMEDOUT: "timeout",
  UND_ERR_CONNECT_TIMEOUT: "timeout",
  UND_ERR_HEADERS_TIMEOUT: "timeout",
  UND_ERR_BODY_TIMEOUT: "timeout",
} as const;
export type TransportCode = keyof typeof transportPhases;
export type TransportPhase = (typeof transportPhases)[TransportCode];
export type TransportDiagnostics = {
  transportCode?: TransportCode | undefined;
  transportPhase?: TransportPhase | undefined;
};

export function transportDiagnostics(error: unknown): TransportDiagnostics {
  const pending: unknown[] = [error];
  const seen = new Set<unknown>();
  for (let index = 0; index < pending.length && index < 16; index++) {
    const value = pending[index];
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    const details = value as Record<string, unknown>;
    // Native abort/deadline timeouts have numeric DOMException code 23.
    // Normalize that runtime shape without accepting arbitrary provider-authored names.
    if (value instanceof DOMException && value.name === "TimeoutError" && value.code === 23) {
      return { transportCode: "ETIMEDOUT", transportPhase: "timeout" };
    }
    const code = details.code;
    if (typeof code === "string" && Object.hasOwn(transportPhases, code)) {
      const transportCode = code as TransportCode;
      return { transportCode, transportPhase: transportPhases[transportCode] };
    }
    if (pending.length < 16 && details.cause) pending.push(details.cause);
    if (Array.isArray(details.errors))
      pending.push(...details.errors.slice(0, 16 - pending.length));
  }
  return {};
}

export class ConnectorError extends Error {
  public readonly category: ConnectorFailureCategory;
  public readonly code: string;
  public readonly disposition: ConnectorFailureDisposition;
  public readonly retryAfterMs: number | null;
  public readonly status: number | null;
  public readonly transportCode?: TransportCode | undefined;
  public readonly transportPhase?: TransportPhase | undefined;

  public constructor(input: {
    category: ConnectorFailureCategory;
    code: string;
    disposition: ConnectorFailureDisposition;
    message: string;
    transportCause?: unknown;
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
    const diagnostic = transportDiagnostics(input.transportCause);
    this.transportCode = diagnostic.transportCode;
    this.transportPhase = diagnostic.transportPhase;
  }
}

export async function connectorHttpError(
  response: Response,
  provider: "google" | "plaid" | "x",
): Promise<ConnectorError> {
  const retryAfterMs = retryAfter(response.headers.get("retry-after"));
  const safeProviderError =
    provider === "google"
      ? await readGoogleErrorCode(response)
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
  if (provider === "google" && response.status === 403) {
    if (
      [
        "rateLimitExceeded",
        "userRateLimitExceeded",
        "dailyLimitExceeded",
        "quotaExceeded",
      ].includes(safeProviderError ?? "")
    ) {
      return new ConnectorError({
        category: "rate_limited",
        code: "google_rate_limited",
        disposition: "retry",
        message: "Google is temporarily rate-limiting nohmi.",
        status: 403,
        ...(retryAfterMs === null ? {} : { retryAfterMs }),
      });
    }
    if (safeProviderError === "insufficientPermissions") {
      return new ConnectorError({
        category: "authorization",
        code: "google_permission_missing",
        disposition: "reconnect",
        message: "Google needs additional permissions for this capability.",
        status: 403,
      });
    }
    if (safeProviderError === "accessNotConfigured") {
      return new ConnectorError({
        category: "configuration",
        code: "google_configuration_invalid",
        disposition: "operator",
        message: "A required Google API is not enabled.",
        status: 403,
      });
    }
    return new ConnectorError({
      category: "rejected",
      code: "google_permission_denied",
      disposition: "operator",
      message: "Google denied access to this resource.",
      status: 403,
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
  if (status === 403) {
    return new ConnectorError({
      category: "rejected",
      code: `icloud_${service}_permission_denied`,
      disposition: "operator",
      message: `iCloud denied access to this ${label} resource.`,
      status,
    });
  }
  return new ConnectorError({
    category: "transport",
    code: `icloud_${service}_transport_failure`,
    transportCause: error,
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
  | "unauthorized_client"
  | "rateLimitExceeded"
  | "userRateLimitExceeded"
  | "dailyLimitExceeded"
  | "quotaExceeded"
  | "insufficientPermissions"
  | "accessNotConfigured";
type PlaidErrorCode = "INVALID_API_KEYS" | "ITEM_LOGIN_REQUIRED" | "RATE_LIMIT_EXCEEDED";

async function readGoogleErrorCode(response: Response): Promise<GoogleOAuthErrorCode | null> {
  if (
    (response.status !== 400 && response.status !== 403) ||
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
    if (response.status === 403) {
      const errors = objectDetails(error)?.errors;
      if (!Array.isArray(errors)) return null;
      for (const entry of errors) {
        const reason = objectDetails(entry)?.reason;
        if (
          reason === "rateLimitExceeded" ||
          reason === "userRateLimitExceeded" ||
          reason === "dailyLimitExceeded" ||
          reason === "quotaExceeded" ||
          reason === "insufficientPermissions" ||
          reason === "accessNotConfigured"
        )
          return reason;
      }
      return null;
    }
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
