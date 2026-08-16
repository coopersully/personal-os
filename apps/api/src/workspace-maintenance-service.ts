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
import { and, asc, eq, inArray, or, type SQL, sql } from "drizzle-orm";
import { AppError, isUniqueViolation } from "./errors.js";

const openStatuses = [
  "queued",
  "running",
  "awaiting_approval",
  "blocked",
  "failed_recoverable",
] as const;
const leaseMilliseconds = 2 * 60_000;
const recoverableRetryMilliseconds = 60_000;

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

type RequeueInput = {
  expectedRulebookVersion: string;
  expectedStatus: "awaiting_approval" | "blocked";
  runId: string;
};

type CheckpointAndReleaseInput = {
  checkpoint: unknown;
  claimId: string;
  runId: string;
};

export type WorkspaceMaintenanceStepRecord = {
  idempotencyKey: string;
  result: unknown;
  status: "completed" | "failed_recoverable" | "failed_terminal";
  step: string;
};

export type WorkspaceMaintenanceService = {
  createOrResume: (
    userId: string,
    domain: AssistantDomain,
    scope: MaintenanceScope,
    rulebookVersion: string,
  ) => Promise<MaintenanceRun>;
  claim: (runId: string) => Promise<{ claimId: string; run: MaintenanceRun } | null>;
  checkpointAndRelease: (input: CheckpointAndReleaseInput) => Promise<MaintenanceRun>;
  completeStep: (input: CompleteStepInput) => Promise<void>;
  failStep: (input: FailStepInput) => Promise<void>;
  getOwnedRun: (userId: string, runId: string) => Promise<MaintenanceRun>;
  listDueRunIds: (domain: AssistantDomain, limit: number) => Promise<string[]>;
  listStepRecords: (runId: string) => Promise<WorkspaceMaintenanceStepRecord[]>;
  requeue: (input: RequeueInput) => Promise<MaintenanceRun>;
  settle: (input: SettleInput) => Promise<MaintenanceRun>;
};

type RunRow = typeof workspaceMaintenanceRuns.$inferSelect;
type FencedRunUpdate = Omit<
  Partial<typeof workspaceMaintenanceRuns.$inferInsert>,
  "retryAt" | "updatedAt"
> & {
  retryAt?: Date | null | SQL;
};

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
    retryAt: row.retryAt?.toISOString() ?? null,
    lastSafeError: row.lastSafeError ?? null,
    settledResult: row.settledResult ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function stableJson(value: unknown): string | undefined {
  return JSON.stringify(value, (_key, nestedValue: unknown) => {
    if (nestedValue !== null && typeof nestedValue === "object" && !Array.isArray(nestedValue)) {
      const record = nestedValue as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(record)
          .sort()
          .map((key) => [key, record[key]]),
      );
    }
    return nestedValue;
  });
}

function jsonMatches(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
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
    if (current.rulebookVersion !== rulebookVersion || !jsonMatches(current.scope, scope)) {
      throw incompatibleRun(current);
    }
    return serializeRun(current);
  }

  async function fenceClaim(
    transaction: Parameters<Parameters<Database["transaction"]>[0]>[0],
    input: { claimId: string; runId: string },
    update: FencedRunUpdate,
  ): Promise<RunRow> {
    const [run] = await transaction
      .update(workspaceMaintenanceRuns)
      .set({ ...update, updatedAt: sql`NOW()` })
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
          retryAt: null,
          status: "running",
          updatedAt: sql`NOW()`,
        })
        .where(
          and(
            eq(workspaceMaintenanceRuns.id, runId),
            or(
              eq(workspaceMaintenanceRuns.status, "queued"),
              and(
                eq(workspaceMaintenanceRuns.status, "failed_recoverable"),
                sql`${workspaceMaintenanceRuns.retryAt} <= NOW()`,
              ),
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

    async checkpointAndRelease(input) {
      const [run] = await db
        .update(workspaceMaintenanceRuns)
        .set({
          checkpoint: input.checkpoint,
          leaseClaimId: null,
          leaseExpiresAt: null,
          status: "queued",
          updatedAt: sql`NOW()`,
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

    async completeStep(input) {
      await db.transaction(async (transaction) => {
        await fenceClaim(transaction, input, {
          checkpoint: { completedStep: input.step },
        });
        const existing = await transaction
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
        const existingByStep = existing.find((row) => row.stepName === input.step);
        const existingByIdempotencyKey = existing.find(
          (row) => row.idempotencyKey === input.idempotencyKey,
        );
        if (existingByStep?.status === "completed") {
          if (
            existingByStep.id === existingByIdempotencyKey?.id &&
            jsonMatches(existingByStep.safeResult, input.result)
          ) {
            return;
          }
          throw new AppError(
            "conflict",
            "The maintenance step name or idempotency key was already used.",
            { runId: input.runId, step: input.step },
          );
        }
        if (existingByIdempotencyKey) {
          throw new AppError(
            "conflict",
            "The maintenance step name or idempotency key was already used.",
            { runId: input.runId, step: input.step },
          );
        }
        if (existingByStep) {
          await transaction
            .update(workspaceMaintenanceSteps)
            .set({
              attemptClaimId: input.claimId,
              attemptCount: sql`${workspaceMaintenanceSteps.attemptCount} + 1`,
              idempotencyKey: input.idempotencyKey,
              safeError: null,
              safeResult: input.result,
              status: "completed",
              updatedAt: sql`NOW()`,
            })
            .where(eq(workspaceMaintenanceSteps.id, existingByStep.id));
          return;
        }
        await transaction.insert(workspaceMaintenanceSteps).values({
          idempotencyKey: input.idempotencyKey,
          attemptClaimId: input.claimId,
          runId: input.runId,
          safeResult: input.result,
          status: "completed",
          stepName: input.step,
          updatedAt: sql`NOW()`,
        });
      });
    },

    async failStep(input) {
      const safeError = { code: input.code, message: input.safeMessage };
      const status = input.recoverable ? "failed_recoverable" : "failed_terminal";
      await db.transaction(async (transaction) => {
        const [existing] = await transaction
          .select()
          .from(workspaceMaintenanceSteps)
          .where(
            and(
              eq(workspaceMaintenanceSteps.runId, input.runId),
              eq(workspaceMaintenanceSteps.stepName, input.step),
            ),
          );
        if (existing?.attemptClaimId === input.claimId) {
          if (existing.status === status && jsonMatches(existing.safeError, safeError)) return;
          throw new AppError(
            "conflict",
            "The maintenance failure was already recorded with different content.",
            { runId: input.runId, step: input.step },
          );
        }
        await fenceClaim(transaction, input, {
          lastSafeError: safeError,
          leaseClaimId: null,
          leaseExpiresAt: null,
          retryAt: input.recoverable
            ? sql`NOW() + ${recoverableRetryMilliseconds} * INTERVAL '1 millisecond'`
            : null,
          status,
        });
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
              attemptClaimId: input.claimId,
              safeError,
              safeResult: null,
              status,
              updatedAt: sql`NOW()`,
            })
            .where(eq(workspaceMaintenanceSteps.id, existing.id));
          return;
        }
        await transaction.insert(workspaceMaintenanceSteps).values({
          idempotencyKey: `failure:${input.step}`,
          attemptClaimId: input.claimId,
          runId: input.runId,
          safeError,
          status,
          stepName: input.step,
          updatedAt: sql`NOW()`,
        });
      });
    },

    async getOwnedRun(userId, runId) {
      const [run] = await db
        .select()
        .from(workspaceMaintenanceRuns)
        .where(
          and(eq(workspaceMaintenanceRuns.id, runId), eq(workspaceMaintenanceRuns.userId, userId)),
        )
        .limit(1);
      if (!run) throw new AppError("not_found", "The workspace maintenance run was not found.");
      return serializeRun(run);
    },

    async listDueRunIds(domain, limit) {
      const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
      const rows = await db
        .select({ id: workspaceMaintenanceRuns.id })
        .from(workspaceMaintenanceRuns)
        .where(
          and(
            eq(workspaceMaintenanceRuns.domain, domain),
            or(
              eq(workspaceMaintenanceRuns.status, "queued"),
              and(
                eq(workspaceMaintenanceRuns.status, "failed_recoverable"),
                sql`${workspaceMaintenanceRuns.retryAt} <= NOW()`,
              ),
              and(
                eq(workspaceMaintenanceRuns.status, "running"),
                sql`${workspaceMaintenanceRuns.leaseExpiresAt} <= NOW()`,
              ),
            ),
          ),
        )
        .orderBy(asc(workspaceMaintenanceRuns.updatedAt), asc(workspaceMaintenanceRuns.id))
        .limit(boundedLimit);
      return rows.map((row) => row.id);
    },

    async listStepRecords(runId) {
      const rows = await db
        .select()
        .from(workspaceMaintenanceSteps)
        .where(eq(workspaceMaintenanceSteps.runId, runId))
        .orderBy(asc(workspaceMaintenanceSteps.createdAt), asc(workspaceMaintenanceSteps.id));
      return rows.map((row) => ({
        idempotencyKey: row.idempotencyKey,
        result: row.safeResult ?? null,
        status: row.status,
        step: row.stepName,
      }));
    },

    async requeue(input) {
      if (input.expectedStatus !== "blocked" && input.expectedStatus !== "awaiting_approval") {
        throw new AppError(
          "invalid_request",
          "Only blocked or awaiting-approval maintenance runs can be requeued.",
        );
      }
      const [run] = await db
        .update(workspaceMaintenanceRuns)
        .set({
          lastSafeError: null,
          leaseClaimId: null,
          leaseExpiresAt: null,
          retryAt: null,
          settledResult: null,
          status: "queued",
          updatedAt: sql`NOW()`,
        })
        .where(
          and(
            eq(workspaceMaintenanceRuns.id, input.runId),
            eq(workspaceMaintenanceRuns.status, input.expectedStatus),
            eq(workspaceMaintenanceRuns.rulebookVersion, input.expectedRulebookVersion),
          ),
        )
        .returning();
      if (!run) {
        throw new AppError(
          "conflict",
          "The workspace maintenance run no longer matches the requeue evidence.",
          { runId: input.runId },
        );
      }
      return serializeRun(run);
    },

    async settle(input) {
      const [run] = await db
        .update(workspaceMaintenanceRuns)
        .set({
          lastSafeError: null,
          leaseClaimId: null,
          leaseExpiresAt: null,
          retryAt:
            input.status === "failed_recoverable"
              ? sql`NOW() + ${recoverableRetryMilliseconds} * INTERVAL '1 millisecond'`
              : null,
          settledResult: input.result,
          status: input.status,
          updatedAt: sql`NOW()`,
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
