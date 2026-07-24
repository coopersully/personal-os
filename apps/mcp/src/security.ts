import { createHash } from "node:crypto";
import type { Request } from "express";
import { z } from "zod";

const securitySchema = z.object({
  MCP_ALLOWED_ORIGINS: z.string().default(""),
  MCP_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(1).max(10_000).default(120),
  MCP_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).max(3_600).default(60),
  MCP_TRUST_PROXY: z.enum(["true", "false"]).default("false"),
});

type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export type McpSecurityConfig = {
  allowedOrigins: Set<string>;
  rateLimitMaxRequests: number;
  rateLimitWindowMs: number;
  trustProxy: boolean;
};

export function loadMcpSecurityConfig(environment: NodeJS.ProcessEnv): McpSecurityConfig {
  const value = securitySchema.parse(environment);
  return {
    allowedOrigins: new Set(
      value.MCP_ALLOWED_ORIGINS.split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
    rateLimitMaxRequests: value.MCP_RATE_LIMIT_MAX_REQUESTS,
    rateLimitWindowMs: value.MCP_RATE_LIMIT_WINDOW_SECONDS * 1_000,
    trustProxy: value.MCP_TRUST_PROXY === "true",
  };
}

/** Native MCP clients do not send Origin. When Origin is present, it must be opted in. */
export function isAllowedOrigin(origin: string | undefined, allowedOrigins: Set<string>): boolean {
  return origin === undefined || allowedOrigins.has(origin);
}

export function requestIp(request: Pick<Request, "header">, trustProxy: boolean): string {
  if (!trustProxy) return "direct";
  return request.header("x-forwarded-for")?.split(",")[0]?.trim() || "direct";
}

/** Keep only a non-reversible token fingerprint in process memory and rate-limit keys. */
export function tokenFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createFixedWindowRateLimiter(options: {
  maxEntries?: number;
  maxRequests: number;
  now?: () => number;
  windowMs: number;
}): { check: (key: string) => RateLimitResult } {
  const buckets = new Map<string, { count: number; startedAt: number }>();
  const maxEntries = options.maxEntries ?? 10_000;
  const now = options.now ?? Date.now;

  return {
    check(key) {
      const current = now();
      const bucket = buckets.get(key);
      if (!bucket || current - bucket.startedAt >= options.windowMs) {
        if (!bucket) evictRateLimitBuckets(buckets, current, options.windowMs, maxEntries);
        buckets.set(key, { count: 1, startedAt: current });
        return { allowed: true };
      }
      if (bucket.count >= options.maxRequests) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((options.windowMs - (current - bucket.startedAt)) / 1_000),
          ),
        };
      }
      bucket.count += 1;
      return { allowed: true };
    },
  };
}

function evictRateLimitBuckets(
  buckets: Map<string, { count: number; startedAt: number }>,
  current: number,
  windowMs: number,
  maxEntries: number,
): void {
  if (buckets.size < maxEntries) return;
  for (const [key, bucket] of buckets) {
    if (current - bucket.startedAt >= windowMs) buckets.delete(key);
  }
  if (buckets.size < maxEntries) return;
  const oldestKey = buckets.keys().next().value;
  if (oldestKey !== undefined) buckets.delete(oldestKey);
}
