export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

type RateLimiterOptions = {
  maxEntries?: number;
  maxRequests: number;
  now?: () => number;
  windowMs: number;
};

/**
 * A small in-process backstop for sensitive endpoints. Production still needs
 * an edge rate limit shared across replicas; this prevents a single instance
 * from accepting unbounded traffic when that edge control is misconfigured.
 */
export function createFixedWindowRateLimiter(options: RateLimiterOptions) {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  const maxEntries = options.maxEntries ?? 10_000;
  const now = options.now ?? Date.now;

  return {
    check(key: string): RateLimitResult {
      const timestamp = now();
      const current = buckets.get(key);
      if (!current || current.resetAt <= timestamp) {
        if (!current) evictRateLimitBuckets(buckets, timestamp, maxEntries);
        buckets.set(key, { count: 1, resetAt: timestamp + options.windowMs });
        return { allowed: true };
      }
      if (current.count >= options.maxRequests) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - timestamp) / 1_000)),
        };
      }
      current.count += 1;
      return { allowed: true };
    },
  };
}

function evictRateLimitBuckets(
  buckets: Map<string, { count: number; resetAt: number }>,
  timestamp: number,
  maxEntries: number,
): void {
  if (buckets.size < maxEntries) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= timestamp) buckets.delete(key);
  }
  if (buckets.size < maxEntries) return;
  const oldestKey = buckets.keys().next().value;
  if (oldestKey !== undefined) buckets.delete(oldestKey);
}
