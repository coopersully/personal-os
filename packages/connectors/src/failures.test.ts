import { describe, expect, it } from "vitest";
import { classifyICloudError, connectorHttpError } from "./failures.js";

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
  ] as const)(
    "classifies Google status %i without provider-authored text",
    async (status, category, disposition, code) => {
      const error = await connectorHttpError(
        new Response("provider-authored secret", { status }),
        "google",
      );

      expect(error).toMatchObject({ category, code, disposition, status });
      expect(error.message).not.toContain("provider-authored secret");
    },
  );

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
});
