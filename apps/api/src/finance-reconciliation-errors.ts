export class FinanceClaimReconciliationError extends Error {
  constructor(readonly failed: number) {
    super(`Finance SMS context reconciliation failed for ${failed} claims.`);
  }
}
export type FinanceStageFailure = {
  stage: "context" | "acknowledgement" | "host" | "notification";
  code: "stage_failed" | "operations_failed";
  count: number;
};
/** Only fixed stage identifiers and validated counts may reach operational logs. */
export class FinanceReconciliationError extends Error {
  constructor(readonly failures: FinanceStageFailure[]) {
    super(
      `Finance reconciliation failed for ${failures.reduce((n, f) => n + f.count, 0)} operations.`,
    );
  }
}
export function financeReconciliationDiagnostic(error: unknown): string {
  return error instanceof FinanceReconciliationError
    ? JSON.stringify(error.failures)
    : "unclassified_stage_failure";
}
