import type { FinanceProvenance } from "@personal-os/domain";
export const emptyFinancePreferences = {
  bufferTarget: null,
  debtPriority: null,
  emergencyReserveMonths: null,
  notes: [],
};
// The server replaces this transport placeholder with authenticated provenance for changed facts.
export const financeStatementSource: FinanceProvenance = {
  actorId: null,
  actorType: "user",
  confidence: null,
  evidence: {},
  maintenanceRunId: null,
  observedAt: "1970-01-01T00:00:00.000Z",
  requestId: null,
  sourceId: null,
};
export function financeNumber(value: string) {
  return value.trim() ? Number(value) : null;
}

export function financeCurrencyNumber(value: string) {
  if (!value.trim()) return null;
  if (!/^-?(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(value.trim()))
    throw new Error("Enter an amount with up to two decimal places.");
  return Number(value);
}
