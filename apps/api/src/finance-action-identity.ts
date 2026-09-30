import { createHash } from "node:crypto";

/**
 * Canonical serialization for Finance action identity. Preparation has already
 * parsed inputs through its action schema; sorting object keys makes the
 * resulting identity independent of caller property order.
 */
export function stableFinanceActionInput(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableFinanceActionInput).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableFinanceActionInput(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The unprefixed identity stored by direct Finance action reviews. */
export function financeActionFingerprint(
  actionKind: string,
  input: Record<string, unknown>,
): string {
  return createHash("sha256")
    .update(`${actionKind}:${stableFinanceActionInput(input)}`)
    .digest("hex");
}

/** The same identity in the durable candidate fingerprint format. */
export function financeCandidateActionFingerprint(
  actionKind: string,
  input: Record<string, unknown>,
): string {
  return `sha256:${financeActionFingerprint(actionKind, input)}`;
}
