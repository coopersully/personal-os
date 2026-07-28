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

/**
 * Track synchronous provider-first Calendar effects until projection and audit commit.
 * This is an error/reconciliation ledger, not durable authority or an idempotency claim.
 */
export function createCalendarProviderEffectLedger(
  operation: string,
  plannedEffects: CalendarProviderEffect[],
) {
  const completedEffects: CalendarProviderEffect[] = [];
  const pendingEffects = [...plannedEffects];

  function complete(effect: CalendarProviderEffect, remoteEventId?: string) {
    const index = pendingEffects.indexOf(effect);
    if (index >= 0) pendingEffects.splice(index, 1);
    completedEffects.push({
      ...effect,
      remoteEventId: remoteEventId ?? effect.remoteEventId,
    });
  }

  function failure(error: unknown, projectionFailure: boolean): AppError {
    const original = error instanceof AppError ? error : null;
    const originalDetails = detailsRecord(original?.details);
    const onlyCompleted = completedEffects.length === 1 ? completedEffects[0] : undefined;
    const details = {
      ...originalDetails,
      completedEffects: [...completedEffects],
      operation,
      partialEffect:
        typeof originalDetails.partialEffect === "string"
          ? originalDetails.partialEffect
          : partialEffectFor(onlyCompleted),
      pendingEffects: [...pendingEffects],
      provider:
        typeof originalDetails.provider === "string"
          ? originalDetails.provider
          : onlyCompleted?.provider,
      recovery:
        typeof originalDetails.recovery === "string" ? originalDetails.recovery : syncRecovery,
      remoteEventId:
        typeof originalDetails.remoteEventId === "string"
          ? originalDetails.remoteEventId
          : onlyCompleted?.remoteEventId,
    };
    if (original && !projectionFailure) {
      return new AppError(original.code, original.message, details);
    }
    return new AppError(
      "service_unavailable",
      projectionFailure
        ? "Calendar providers were changed, but Ilo could not commit its local projection and audit."
        : "A Calendar provider mutation failed after one or more provider effects completed.",
      details,
    );
  }

  return {
    async commit<T>(operationToCommit: () => Promise<T>): Promise<T> {
      try {
        return await operationToCommit();
      } catch (error) {
        if (completedEffects.length === 0) throw error;
        throw failure(error, true);
      }
    },

    async run<T>(effect: CalendarProviderEffect, providerOperation: () => Promise<T>): Promise<T> {
      try {
        const result = await providerOperation();
        complete(effect, resultRemoteEventId(result));
        return result;
      } catch (error) {
        const originalDetails = error instanceof AppError ? detailsRecord(error.details) : {};
        if (typeof originalDetails.partialEffect === "string") {
          complete(
            effect,
            typeof originalDetails.remoteEventId === "string"
              ? originalDetails.remoteEventId
              : undefined,
          );
        }
        if (completedEffects.length === 0) throw error;
        throw failure(error, false);
      }
    },
  };
}
