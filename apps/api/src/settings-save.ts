import { AppError } from "./errors.js";
import type { Principal } from "./types.js";

export type SettingsMutationContext = { principal: Principal; requestId: string };

/** Compare exact domain revisions; callers retain their own defaults, locks and version rules. */
export function assertSettingsRevision(
  current: number | null,
  expected: number | null,
  message: string,
  details?: Record<string, unknown>,
) {
  if (current !== expected) throw new AppError("conflict", message, details);
}
