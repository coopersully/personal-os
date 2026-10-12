export class ReviewSearchOverflowError extends Error {
  constructor() {
    super("Review search source exceeds its bounded read budget.");
    this.name = "ReviewSearchOverflowError";
  }
}

/** Overflow invalidates a search source: a truncated evidence set cannot establish review truth. */
export async function readProjectionRows<Row>(
  query: PromiseLike<Row[]> & { limit(value: number): PromiseLike<Row[]> },
  limit?: number,
): Promise<Row[]> {
  if (limit === undefined) return query;
  const rows = await query.limit(limit + 1);
  if (rows.length > limit) throw new ReviewSearchOverflowError();
  return rows;
}
