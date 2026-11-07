/** A proposed action or a follow-up question is not a saved financial record. */
export function appliedTransaction<T extends { id: string }>(
  value: T | { status: string; result?: T },
): T | null {
  if (!("status" in value)) return value;
  return value.status === "applied" && value.result ? value.result : null;
}
