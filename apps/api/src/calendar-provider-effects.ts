import type { CalendarProvider } from "@personal-os/domain";
import { AppError } from "./errors.js";

export type CalendarProviderEffect = {
  action: "create" | "delete" | "update";
  calendarId: string;
  eventId: string | null;
  provider: Exclude<CalendarProvider, "local">;
  remoteEventId: string | null;
  role: "block" | "source";
};

const syncRecovery =
  "Synchronize Calendar before retrying so Ilo can reconcile provider truth with its local projection.";

function detailsRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function resultRemoteEventId(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("remoteEventId" in value)) {
    return undefined;
  }
  return typeof value.remoteEventId === "string" ? value.remoteEventId : undefined;
}

function partialEffectFor(effect: CalendarProviderEffect | undefined): string {
  switch (effect?.action) {
    case "create":
      return "provider_event_created";
    case "delete":
      return "provider_event_deleted";
    case "update":
      return "provider_event_updated";
    default:
      return "provider_events_partially_applied";
  }
}

function effectIdentity(effect: CalendarProviderEffect): string {
  return JSON.stringify([
    effect.action,
    effect.calendarId,
    effect.eventId,
    effect.provider,
    effect.remoteEventId,
    effect.role,
  ]);
}

/**
 * Track synchronous provider-first Calendar effects until projection and audit commit.
 * This is an error/reconciliation ledger, not durable authority or an idempotency claim.
 */
export function createCalendarProviderEffectLedger(
  operation: string,
  plannedEffects: CalendarProviderEffect[],
  observeFailure?: (error: AppError) => void,
) {
  const completedEffects: CalendarProviderEffect[] = [];
  const indeterminateEffects: CalendarProviderEffect[] = [];
  const pendingByIdentity = new Map(
    plannedEffects.map((effect) => [effectIdentity(effect), effect] as const),
  );
  if (pendingByIdentity.size !== plannedEffects.length) {
    throw new AppError("internal_error", "The Calendar provider plan contains duplicate effects.");
  }
  const runningIdentities = new Set<string>();

  function begin(effect: CalendarProviderEffect): CalendarProviderEffect {
    const identity = effectIdentity(effect);
    const planned = pendingByIdentity.get(identity);
    if (!planned || runningIdentities.has(identity)) {
      throw new AppError(
        "internal_error",
        "The Calendar provider effect is unknown or has already been settled.",
      );
    }
    runningIdentities.add(identity);
    return planned;
  }

  function settle(effect: CalendarProviderEffect): CalendarProviderEffect {
    const identity = effectIdentity(effect);
    const planned = pendingByIdentity.get(identity);
    if (!planned || !runningIdentities.delete(identity)) {
      throw new AppError(
        "internal_error",
        "The Calendar provider effect could not be settled consistently.",
      );
    }
    pendingByIdentity.delete(identity);
    return planned;
  }

  function complete(effect: CalendarProviderEffect, remoteEventId?: string) {
    const planned = settle(effect);
    completedEffects.push({
      ...planned,
      remoteEventId: remoteEventId ?? planned.remoteEventId,
    });
  }

  function markIndeterminate(effect: CalendarProviderEffect) {
    indeterminateEffects.push(settle(effect));
  }

  function pendingEffects(): CalendarProviderEffect[] {
    return [...pendingByIdentity.values()];
  }

  function failure(error: unknown, projectionFailure: boolean): AppError {
    const original = error instanceof AppError ? error : null;
    const originalDetails = detailsRecord(original?.details);
    const knownEffects = [...completedEffects, ...indeterminateEffects];
    const onlyKnown = knownEffects.length === 1 ? knownEffects[0] : undefined;
    const details = {
      ...originalDetails,
      completedEffects: [...completedEffects],
      indeterminateEffects: [...indeterminateEffects],
      operation,
      partialEffect:
        typeof originalDetails.partialEffect === "string"
          ? originalDetails.partialEffect
          : indeterminateEffects.length > 0
            ? "provider_effect_indeterminate"
            : partialEffectFor(onlyKnown),
      pendingEffects: pendingEffects(),
      provider:
        typeof originalDetails.provider === "string"
          ? originalDetails.provider
          : onlyKnown?.provider,
      recovery:
        typeof originalDetails.recovery === "string" ? originalDetails.recovery : syncRecovery,
      remoteEventId:
        typeof originalDetails.remoteEventId === "string"
          ? originalDetails.remoteEventId
          : onlyKnown?.remoteEventId,
    };
    const result =
      original && (!projectionFailure || original.code === "conflict")
        ? new AppError(original.code, original.message, details)
        : new AppError(
            "service_unavailable",
            projectionFailure
              ? "Calendar providers were changed, but Ilo could not commit its local projection and audit."
              : "A Calendar provider mutation failed after one or more provider effects completed.",
            details,
          );
    /* v8 ignore start -- an observer must never replace the provider reconciliation error */
    try {
      observeFailure?.(result);
    } catch {}
    /* v8 ignore stop */
    return result;
  }

  return {
    async commit<T>(operationToCommit: () => Promise<T>): Promise<T> {
      if (pendingByIdentity.size > 0) {
        const error = new AppError(
          "internal_error",
          "The Calendar provider plan still has pending effects.",
        );
        if (completedEffects.length > 0 || indeterminateEffects.length > 0) {
          throw failure(error, false);
        }
        throw error;
      }
      try {
        return await operationToCommit();
      } catch (error) {
        if (completedEffects.length === 0 && indeterminateEffects.length === 0) throw error;
        throw failure(error, true);
      }
    },

    async run<T>(effect: CalendarProviderEffect, providerOperation: () => Promise<T>): Promise<T> {
      const planned = begin(effect);
      try {
        const result = await providerOperation();
        complete(planned, resultRemoteEventId(result));
        return result;
      } catch (error) {
        const originalDetails = error instanceof AppError ? detailsRecord(error.details) : {};
        if (originalDetails.effectState === "indeterminate") {
          markIndeterminate(planned);
          throw failure(error, false);
        }
        if (typeof originalDetails.partialEffect === "string") {
          complete(
            planned,
            typeof originalDetails.remoteEventId === "string"
              ? originalDetails.remoteEventId
              : undefined,
          );
        } else {
          runningIdentities.delete(effectIdentity(planned));
        }
        if (completedEffects.length === 0 && indeterminateEffects.length === 0) throw error;
        throw failure(error, false);
      }
    },
  };
}
