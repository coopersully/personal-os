import {
  createFixedWindowRateLimiter,
  isAllowedOrigin,
  loadMcpSecurityConfig,
  tokenFingerprint,
} from "./security.js";

describe("MCP HTTP security", () => {
  it("allows native clients and explicitly configured browser origins", () => {
    const config = loadMcpSecurityConfig({ MCP_ALLOWED_ORIGINS: "https://app.example.com" });
    expect(isAllowedOrigin(undefined, config.allowedOrigins)).toBe(true);
    expect(isAllowedOrigin("https://app.example.com", config.allowedOrigins)).toBe(true);
    expect(isAllowedOrigin("https://untrusted.example.com", config.allowedOrigins)).toBe(false);
  });

  it("rate limits using a non-reversible token fingerprint", () => {
    let current = 0;
    const limiter = createFixedWindowRateLimiter({
      maxRequests: 1,
      now: () => current,
      windowMs: 60_000,
    });
    const fingerprint = tokenFingerprint("personal-secret-token");

    expect(fingerprint).not.toContain("personal-secret-token");
    expect(limiter.check(`${fingerprint}:203.0.113.1`)).toEqual({ allowed: true });
    expect(limiter.check(`${fingerprint}:203.0.113.1`)).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
    current = 60_000;
    expect(limiter.check(`${fingerprint}:203.0.113.1`)).toEqual({ allowed: true });
  });

  it("bounds stored rate-limit keys", () => {
    const limiter = createFixedWindowRateLimiter({
      maxEntries: 1,
      maxRequests: 1,
      now: () => 0,
      windowMs: 60_000,
    });
    expect(limiter.check("first")).toEqual({ allowed: true });
    expect(limiter.check("second")).toEqual({ allowed: true });
    expect(limiter.check("first")).toEqual({ allowed: true });
  });
});
