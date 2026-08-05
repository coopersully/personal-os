import { describe, expect, it } from "vitest";
import { ConnectorError, classifyICloudError, connectorHttpError } from "./failures.js";

describe("connector failure boundary", () => {
  it.each([
    '{"error":{"message":"token=raw-secret","status":"UNAVAILABLE"}}',
    "<html>private upstream failure</html>",
    "x".repeat(100_000),
  ])("never exposes a Google provider body", async (body) => {
    const error = await connectorHttpError(
      new Response(body, { headers: { "content-type": "application/json" }, status: 503 }),
      "google",
    );

    expect(error).toMatchObject({
      category: "temporary",
      code: "google_temporary_failure",
      disposition: "retry",
      message: "Google is temporarily unavailable.",
      status: 503,
    });
    expect(error.message).not.toContain(body.slice(0, 20));
    expect(JSON.stringify(error)).not.toContain(body.slice(0, 20));
  });

  it.each([
    [401, "authorization", "reconnect", "google_authorization_failed"],
    [403, "authorization", "reconnect", "google_authorization_failed"],
    [404, "not_found", "operator", "google_resource_not_found"],
    [408, "temporary", "retry", "google_temporary_failure"],
    [429, "rate_limited", "retry", "google_rate_limited"],
    [500, "temporary", "retry", "google_temporary_failure"],
  ] as const)("classifies Google status %i without provider-authored text", async (status, category, disposition, code) => {
    const error = await connectorHttpError(
      new Response("provider-authored secret", { status }),
      "google",
    );

    expect(error).toMatchObject({ category, code, disposition, status });
    expect(error.message).not.toContain("provider-authored secret");
  });

  it("uses only allowlisted Google OAuth error codes as positive recovery evidence", async () => {
    const revokedGrant = await connectorHttpError(
      new Response(
        JSON.stringify({
          error: "invalid_grant",
          error_description: "raw provider detail with a private token",
        }),
        { headers: { "content-type": "application/json" }, status: 400 },
      ),
      "google",
    );
    expect(revokedGrant).toMatchObject({
      category: "authorization",
      code: "google_authorization_failed",
      disposition: "reconnect",
      message: "Google authorization is no longer valid.",
      status: 400,
    });
    expect(JSON.stringify(revokedGrant)).not.toContain("raw provider detail");

    const invalidClient = await connectorHttpError(
      new Response(JSON.stringify({ error: "invalid_client", detail: "private" }), {
        headers: { "content-type": "application/json" },
        status: 400,
      }),
      "google",
    );
    expect(invalidClient).toMatchObject({
      category: "configuration",
      code: "google_configuration_invalid",
      disposition: "operator",
      message: "Google is not configured correctly.",
      status: 400,
    });
    expect(JSON.stringify(invalidClient)).not.toContain("private");
  });

  it.each([
    "not-json",
    JSON.stringify({ error: "provider_invented_code", detail: "private" }),
    JSON.stringify({ error: { code: "invalid_grant" } }),
    JSON.stringify({ error: "invalid_grant", padding: "x".repeat(8_192) }),
  ])("fails closed for untrusted or oversized Google OAuth bodies", async (body) => {
    const error = await connectorHttpError(
      new Response(body, { headers: { "content-type": "application/json" }, status: 400 }),
      "google",
    );

    expect(error).toMatchObject({
      category: "rejected",
      code: "google_request_rejected",
      disposition: "operator",
      message: "Google rejected the request.",
      status: 400,
    });
    expect(JSON.stringify(error)).not.toContain("provider_invented_code");
    expect(JSON.stringify(error)).not.toContain("padding");
  });

  it("honors only a bounded Retry-After value", async () => {
    const bounded = await connectorHttpError(
      new Response("rate limited", { headers: { "retry-after": "120" }, status: 429 }),
      "google",
    );
    const capped = await connectorHttpError(
      new Response("rate limited", { headers: { "retry-after": "999999" }, status: 429 }),
      "google",
    );

    expect(bounded.retryAfterMs).toBe(120_000);
    expect(capped.retryAfterMs).toBe(86_400_000);
  });

  it("classifies only positive iCloud authentication evidence as reconnect", () => {
    expect(classifyICloudError("mail", { authenticationFailed: true })).toMatchObject({
      category: "authorization",
      code: "icloud_mail_authorization_failed",
      disposition: "reconnect",
    });
    expect(
      classifyICloudError("calendar", { responseStatus: "AUTHENTICATIONFAILED" }),
    ).toMatchObject({
      category: "authorization",
      code: "icloud_calendar_authorization_failed",
      disposition: "reconnect",
    });
    expect(classifyICloudError("mail", new Error("socket closed"))).toMatchObject({
      category: "transport",
      code: "icloud_mail_transport_failure",
      disposition: "retry",
    });
  });

  it("classifies alternate safe provider and iCloud evidence", async () => {
    await expect(
      connectorHttpError(new Response(null, { status: 400 }), "x"),
    ).resolves.toMatchObject({
      category: "rejected",
      code: "x_request_rejected",
      message: "X rejected the request.",
    });
    await expect(
      connectorHttpError(
        new Response(null, { headers: { "retry-after": "not-a-date" }, status: 429 }),
        "x",
      ),
    ).resolves.toMatchObject({ retryAfterMs: null });

    const existing = new ConnectorError({
      category: "configuration",
      code: "existing",
      disposition: "operator",
      message: "Safe boundary message",
    });
    expect(classifyICloudError("mail", existing)).toBe(existing);
    expect(classifyICloudError("mail", { code: "EAUTH", statusCode: 403 })).toMatchObject({
      category: "authorization",
      status: 403,
    });
    expect(classifyICloudError("calendar", { status: 502 })).toMatchObject({
      category: "transport",
      status: 502,
    });
    expect(classifyICloudError("mail", null)).toMatchObject({
      category: "transport",
      status: null,
    });
  });
});
