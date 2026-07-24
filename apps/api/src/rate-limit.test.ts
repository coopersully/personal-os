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
});
