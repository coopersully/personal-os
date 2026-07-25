import {
  createFixedWindowRateLimiter,
  isAllowedOrigin,
  loadMcpSecurityConfig,
  requestIp,
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

  it("uses a forwarded client address only when proxy trust is enabled", () => {
    const request = {
      header: vi.fn().mockReturnValue("203.0.113.4, 10.0.0.2"),
    };

    expect(requestIp(request, false)).toBe("direct");
    expect(requestIp(request, true)).toBe("203.0.113.4");
    request.header.mockReturnValue(undefined);
    expect(requestIp(request, true)).toBe("direct");
  });

  it("loads explicit proxy and limiter settings", () => {
    expect(
      loadMcpSecurityConfig({
        MCP_ALLOWED_ORIGINS: " https://one.example, ,https://two.example ",
        MCP_RATE_LIMIT_MAX_REQUESTS: "3",
        MCP_RATE_LIMIT_WINDOW_SECONDS: "4",
        MCP_TRUST_PROXY: "true",
      }),
    ).toEqual({
      allowedOrigins: new Set(["https://one.example", "https://two.example"]),
      rateLimitMaxRequests: 3,
      rateLimitWindowMs: 4_000,
      trustProxy: true,
    });
  });

  it("evicts expired buckets before the oldest active bucket", () => {
    let current = 0;
    const limiter = createFixedWindowRateLimiter({
      maxEntries: 2,
      maxRequests: 2,
      now: () => current,
      windowMs: 10,
    });
    expect(limiter.check("expired")).toEqual({ allowed: true });
    current = 5;
    expect(limiter.check("active")).toEqual({ allowed: true });
    current = 11;
    expect(limiter.check("new")).toEqual({ allowed: true });
    expect(limiter.check("active")).toEqual({ allowed: true });
  });

  it("uses default limiter options when omitted", () => {
    vi.spyOn(Date, "now").mockReturnValue(100);
    const limiter = createFixedWindowRateLimiter({ maxRequests: 1, windowMs: 1_000 });
    expect(limiter.check("default")).toEqual({ allowed: true });
    vi.restoreAllMocks();
  });
});
