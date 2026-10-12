import { type AccountSetupStep, accountSetupStepSchema } from "@personal-os/domain";

/** A tab-local cursor only. Durable first-time setup remains server-owned. */
export function readSetupReplay(userId: string): AccountSetupStep | null {
  try {
    const parsed = accountSetupStepSchema.safeParse(
      sessionStorage.getItem(`nohmi.setup-replay.${userId}`),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
export function writeSetupReplay(userId: string, step: AccountSetupStep | null) {
  try {
    const key = `nohmi.setup-replay.${userId}`;
    if (step === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, step);
  } catch {
    /* Replay still works in memory when browser storage is unavailable. */
  }
}
