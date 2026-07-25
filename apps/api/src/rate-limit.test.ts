import { createFixedWindowRateLimiter } from "./rate-limit.js";

describe("fixed-window rate limiter", () => {
  it("limits a key and resets its window", () => {
    let time = 0;
    const limiter = createFixedWindowRateLimiter({
      maxRequests: 2,
      now: () => time,
      windowMs: 10_000,
    });
    expect(limiter.check("user")).toEqual({ allowed: true });
    expect(limiter.check("user")).toEqual({ allowed: true });
    expect(limiter.check("user")).toEqual({ allowed: false, retryAfterSeconds: 10 });
    time = 10_000;
    expect(limiter.check("user")).toEqual({ allowed: true });
  });

  it("bounds tracked sources without denying new traffic during an abuse burst", () => {
    const limiter = createFixedWindowRateLimiter({
      maxEntries: 1,
      maxRequests: 1,
      now: () => 0,
      windowMs: 10_000,
    });
    expect(limiter.check("first-source")).toEqual({ allowed: true });
    expect(limiter.check("second-source")).toEqual({ allowed: true });
    expect(limiter.check("first-source")).toEqual({ allowed: true });
  });

  it("evicts expired sources before active ones", () => {
    let time = 0;
    const limiter = createFixedWindowRateLimiter({
      maxEntries: 2,
      maxRequests: 2,
      now: () => time,
      windowMs: 10,
    });
    expect(limiter.check("expired")).toEqual({ allowed: true });
    time = 5;
    expect(limiter.check("active")).toEqual({ allowed: true });
    time = 11;
    expect(limiter.check("new")).toEqual({ allowed: true });
    expect(limiter.check("active")).toEqual({ allowed: true });
  });

  it("uses the system clock and default capacity when omitted", () => {
    vi.spyOn(Date, "now").mockReturnValue(100);
    const limiter = createFixedWindowRateLimiter({ maxRequests: 1, windowMs: 1_000 });
    expect(limiter.check("default")).toEqual({ allowed: true });
    vi.restoreAllMocks();
  });
});
