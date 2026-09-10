import type { CalendarProviderFailureObservation } from "./calendar-service.js";
import type { CalendarProviderReconciliationLog } from "./types.js";

/**
 * Keep provider reconciliation logs useful without copying connector payloads,
 * event identifiers, user identifiers, or provider error messages into logs.
 */
export function calendarProviderReconciliationLog(
  observation: CalendarProviderFailureObservation,
): CalendarProviderReconciliationLog {
  return {
    actorType: observation.actorType,
    code: observation.code,
    operation: observation.operation,
  };
}
