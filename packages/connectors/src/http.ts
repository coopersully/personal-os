export const PROVIDER_REQUEST_TIMEOUT_MS = 15_000;

/**
 * Runs one provider HTTP request inside the interactive API budget.
 *
 * Provider pagination and bootstrap work can contain multiple requests, so each
 * request must leave room below the public edge timeout for persistence and a
 * structured API response.
 */
export function providerFetch(
  request: typeof globalThis.fetch,
  input: Parameters<typeof globalThis.fetch>[0],
  init: RequestInit = {},
  timeoutMs = PROVIDER_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return request(input, {
    ...init,
    signal: init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal,
  });
}
