import { randomUUID } from "node:crypto";
import {
  type Database,
  workspaceMaintenanceRuns,
  workspaceMaintenanceSteps,
} from "@personal-os/database";
import {
  type AssistantDomain,
  type MaintenanceRun,
  type MaintenanceScope,
  type MaintenanceSettlementStatus,
  maintenanceRunSchema,
  maintenanceScopeSchema,
} from "@personal-os/domain";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { AppError, isUniqueViolation } from "./errors.js";

const openStatuses = [
  "queued",
  "running",
  "awaiting_approval",
  "blocked",
  "failed_recoverable",
] as const;
const leaseMilliseconds = 2 * 60_000;

type Options = { db: Database; now: () => Date };

type CompleteStepInput = {
  claimId: string;
  idempotencyKey: string;
  result: unknown;
  runId: string;
  step: string;
};

type FailStepInput = {
  claimId: string;
  code: string;
  recoverable: boolean;
  runId: string;
  safeMessage: string;
  step: string;
};

type SettleInput = {
  claimId: string;
  result: unknown;
  runId: string;
  status: MaintenanceSettlementStatus;
};

export type WorkspaceMaintenanceService = {
  createOrResume: (
    userId: string,
    domain: AssistantDomain,
    scope: MaintenanceScope,
    rulebookVersion: string,
  ) => Promise<MaintenanceRun>;
  claim: (runId: string) => Promise<{ claimId: string; run: MaintenanceRun } | null>;
  completeStep: (input: CompleteStepInput) => Promise<void>;
  failStep: (input: FailStepInput) => Promise<void>;
  settle: (input: SettleInput) => Promise<MaintenanceRun>;
};

type RunRow = typeof workspaceMaintenanceRuns.$inferSelect;

function serializeRun(row: RunRow): MaintenanceRun {
  return maintenanceRunSchema.parse({
    id: row.id,
    userId: row.userId,
    domain: row.domain,
    scope: row.scope,
    status: row.status,
    rulebookVersion: row.rulebookVersion,
    sourceSnapshot: row.sourceSnapshot ?? null,
    checkpoint: row.checkpoint ?? null,
    leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
    lastSafeError: row.lastSafeError ?? null,
    settledResult: row.settledResult ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function scopesMatch(left: MaintenanceScope, right: MaintenanceScope): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function incompatibleRun(current: RunRow): AppError {
  return new AppError("conflict", "An incompatible workspace maintenance run is already open.", {
    currentRunId: current.id,
    currentRulebookVersion: current.rulebookVersion,
    currentScope: current.scope,
    currentStatus: current.status,
  });
}

export function createWorkspaceMaintenanceService({
  db,
  now,
}: Options): WorkspaceMaintenanceService {
  async function findOpenRun(userId: string, domain: AssistantDomain): Promise<RunRow | undefined> {
    const [run] = await db
      .select()
      .from(workspaceMaintenanceRuns)
      .where(
        and(
          eq(workspaceMaintenanceRuns.userId, userId),
          eq(workspaceMaintenanceRuns.domain, domain),
          inArray(workspaceMaintenanceRuns.status, [...openStatuses]),
        ),
      );
    return run;
  }

  function compatibleOrConflict(
    current: RunRow,
    scope: MaintenanceScope,
    rulebookVersion: string,
  ): MaintenanceRun {
    if (current.rulebookVersion !== rulebookVersion || !scopesMatch(current.scope, scope)) {
      throw incompatibleRun(current);
    }
    return serializeRun(current);
  }

  async function fenceClaim(
    transaction: Parameters<Parameters<Database["transaction"]>[0]>[0],
    input: { claimId: string; runId: string },
    update: Partial<typeof workspaceMaintenanceRuns.$inferInsert>,
  ): Promise<RunRow> {
    const [run] = await transaction
      .update(workspaceMaintenanceRuns)
      .set(update)
      .where(
        and(
          eq(workspaceMaintenanceRuns.id, input.runId),
          eq(workspaceMaintenanceRuns.status, "running"),
          eq(workspaceMaintenanceRuns.leaseClaimId, input.claimId),
          sql`${workspaceMaintenanceRuns.leaseExpiresAt} > NOW()`,
        ),
      )
      .returning();
    if (!run) {
      throw new AppError("conflict", "The workspace maintenance claim is no longer current.", {
        runId: input.runId,
      });
    }
    return run;
  }

  return {
    async createOrResume(userId, domain, inputScope, rulebookVersion) {
      const scope = maintenanceScopeSchema.parse(inputScope);
      const existing = await findOpenRun(userId, domain);
      if (existing) return compatibleOrConflict(existing, scope, rulebookVersion);

      try {
        const [created] = await db
          .insert(workspaceMaintenanceRuns)
          .values({
            domain,
            rulebookVersion,
            scope,
            status: "queued",
            updatedAt: now(),
            userId,
          })
          .returning();
        if (!created) {
          throw new AppError("internal_error", "The workspace maintenance run was not created.");
        }
        return serializeRun(created);
      } catch (error) {
        if (!isUniqueViolation(error, "workspace_maintenance_runs_open_user_domain_idx")) {
          throw error;
        }
        const raced = await findOpenRun(userId, domain);
        if (!raced) {
          throw new AppError(
            "conflict",
            "A concurrent workspace maintenance run changed before it could be resumed.",
          );
        }
        return compatibleOrConflict(raced, scope, rulebookVersion);
      }
    },

    async claim(runId) {
      const claimId = randomUUID();
      const [run] = await db
        .update(workspaceMaintenanceRuns)
        .set({
          leaseClaimId: claimId,
          leaseExpiresAt: sql`NOW() + ${leaseMilliseconds} * INTERVAL '1 millisecond'`,
          status: "running",
          updatedAt: sql`NOW()`,
        })
        .where(
          and(
            eq(workspaceMaintenanceRuns.id, runId),
            or(
              eq(workspaceMaintenanceRuns.status, "queued"),
              eq(workspaceMaintenanceRuns.status, "failed_recoverable"),
              and(
                eq(workspaceMaintenanceRuns.status, "running"),
                sql`${workspaceMaintenanceRuns.leaseExpiresAt} <= NOW()`,
              ),
            ),
          ),
        )
        .returning();
      return run ? { claimId, run: serializeRun(run) } : null;
    },

    async completeStep(input) {
      await db.transaction(async (transaction) => {
        await fenceClaim(transaction, input, {
          checkpoint: { completedStep: input.step },
          updatedAt: now(),
        });
        const [existing] = await transaction
          .select()
          .from(workspaceMaintenanceSteps)
          .where(
            and(
              eq(workspaceMaintenanceSteps.runId, input.runId),
              or(
                eq(workspaceMaintenanceSteps.stepName, input.step),
                eq(workspaceMaintenanceSteps.idempotencyKey, input.idempotencyKey),
              ),
            ),
          );
        if (existing) {
          if (
            existing.stepName === input.step &&
            existing.idempotencyKey === input.idempotencyKey &&
            existing.status === "completed" &&
            JSON.stringify(existing.safeResult) === JSON.stringify(input.result)
          ) {
            return;
          }
          throw new AppError(
            "conflict",
            "The maintenance step name or idempotency key was already used.",
            { runId: input.runId, step: input.step },
          );
        }
        await transaction.insert(workspaceMaintenanceSteps).values({
          idempotencyKey: input.idempotencyKey,
          runId: input.runId,
          safeResult: input.result,
          status: "completed",
          stepName: input.step,
          updatedAt: now(),
        });
      });
    },

    async failStep(input) {
      const safeError = { code: input.code, message: input.safeMessage };
      const status = input.recoverable ? "failed_recoverable" : "failed_terminal";
      await db.transaction(async (transaction) => {
        await fenceClaim(transaction, input, {
          lastSafeError: safeError,
          leaseClaimId: null,
          leaseExpiresAt: null,
          status,
          updatedAt: now(),
        });
        const [existing] = await transaction
          .select()
          .from(workspaceMaintenanceSteps)
          .where(
            and(
              eq(workspaceMaintenanceSteps.runId, input.runId),
              eq(workspaceMaintenanceSteps.stepName, input.step),
            ),
          );
        if (existing?.status === "completed") {
          throw new AppError(
            "conflict",
            "A completed maintenance step cannot be replaced by a failure.",
            { runId: input.runId, step: input.step },
          );
        }
        if (existing) {
          await transaction
            .update(workspaceMaintenanceSteps)
            .set({
              attemptCount: sql`${workspaceMaintenanceSteps.attemptCount} + 1`,
              safeError,
              safeResult: null,
              status,
              updatedAt: now(),
            })
            .where(eq(workspaceMaintenanceSteps.id, existing.id));
          return;
        }
        await transaction.insert(workspaceMaintenanceSteps).values({
          idempotencyKey: `failure:${input.step}`,
          runId: input.runId,
          safeError,
          status,
          stepName: input.step,
          updatedAt: now(),
        });
      });
    },

    async settle(input) {
      const [run] = await db
        .update(workspaceMaintenanceRuns)
        .set({
          lastSafeError: null,
          leaseClaimId: null,
          leaseExpiresAt: null,
          settledResult: input.result,
          status: input.status,
          updatedAt: now(),
        })
        .where(
          and(
            eq(workspaceMaintenanceRuns.id, input.runId),
            eq(workspaceMaintenanceRuns.status, "running"),
            eq(workspaceMaintenanceRuns.leaseClaimId, input.claimId),
            sql`${workspaceMaintenanceRuns.leaseExpiresAt} > NOW()`,
          ),
        )
        .returning();
      if (!run) {
        throw new AppError("conflict", "The workspace maintenance claim is no longer current.", {
          runId: input.runId,
        });
      }
      return serializeRun(run);
    },
  };
}
