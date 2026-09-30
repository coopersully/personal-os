import { type Database, financeMaintenanceRuns } from "@personal-os/database";
import {
  type FinanceMaintenanceRecovery,
  idSchema,
  type MaintenanceScope,
} from "@personal-os/domain";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { AppError } from "../errors.js";

const legacyScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("all_outstanding") }).strict(),
  z.object({ type: z.literal("accounts"), accountIds: z.array(idSchema).min(1).max(100) }).strict(),
  z.object({ type: z.literal("since"), from: z.iso.date() }).strict(),
]);

/** Recovery preserves the requested boundary. Unknown scope never means all records. */
export function legacyMaintenanceScope(
  scope: unknown,
  throughDate: string,
): {
  scope: MaintenanceScope | null;
  throughDate: string | null;
  reason: string;
} {
  const parsed = legacyScopeSchema.safeParse(scope);
  if (!parsed.success)
    return {
      scope: null,
      throughDate: null,
      reason:
        "The saved scope is invalid. Inspect the historical run and explicitly start maintenance for the intended accounts or dates.",
    };
  if (parsed.data.type === "all_outstanding")
    return {
      scope: { type: "all_outstanding" },
      throughDate: null,
      reason:
        "Resume full maintenance from current evidence; prior judgments will not be replayed.",
    };
  if (parsed.data.type === "accounts") {
    const ids = [...new Set(parsed.data.accountIds)];
    if (ids.length === 1)
      return {
        scope: { type: "target", entityType: "finance_account", id: ids[0] as string },
        throughDate: null,
        reason: "Resume this exact account from current evidence.",
      };
    return {
      scope: null,
      throughDate: null,
      reason:
        "This historical run covers multiple accounts. Start a finance_account target run for each account in originalScope.accountIds, completing one before starting the next. The saved account set has not been widened.",
    };
  }
  if (parsed.data.from > throughDate)
    return {
      scope: null,
      throughDate,
      reason:
        "The saved start date is after the recovery cutoff. Explicitly choose a valid date window; no broader run was started.",
    };
  return {
    scope: { type: "window", start: parsed.data.from, end: throughDate },
    throughDate,
    reason: "Resume the saved start date through the fixed recovery cutoff from current evidence.",
  };
}

/** Historical protocol storage is evidence only. It has no execution or settlement operation. */
export function createLegacyFinanceMaintenanceService({ db }: { db: Database }) {
  return {
    async getRun(userId: string, runId: string) {
      const row = await db.query.financeMaintenanceRuns.findFirst({
        where: and(eq(financeMaintenanceRuns.userId, userId), eq(financeMaintenanceRuns.id, runId)),
      });
      if (!row)
        throw new AppError("not_found", "The historical Finance maintenance run was not found.");
      return row;
    },
    async history(userId: string, limit = 20) {
      const rows = await db
        .select()
        .from(financeMaintenanceRuns)
        .where(eq(financeMaintenanceRuns.userId, userId))
        .orderBy(desc(financeMaintenanceRuns.createdAt))
        .limit(Math.max(1, Math.min(limit, 100)));
      return rows.map((row) => ({
        id: row.id,
        stage: row.stage,
        scope: row.scope,
        verified: false as const,
        createdAt: row.createdAt.toISOString(),
        recovery: row.recovery as FinanceMaintenanceRecovery | null,
      }));
    },
  };
}
