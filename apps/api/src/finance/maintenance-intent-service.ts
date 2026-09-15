import { isDeepStrictEqual } from "node:util";
import {
  type Database,
  financeAccounts,
  financeLedgerChallenges,
  financeMaintenanceCandidates,
  financeMaintenanceRuns,
  financePeriodReviews,
  financeSetupSessions,
  workspaceMaintenanceRuns,
  workspaceMaintenanceSteps,
} from "@personal-os/database";
import {
  type FinanceMaintenanceHistoryQuery,
  type FinanceMaintenanceInput,
  type FinanceMaintenancePayload,
  type FinanceMaintenanceRecovery,
  type FinanceToolResult,
  financeMaintenanceInputSchema,
  idSchema,
  type MaintenanceRun,
  maintenanceRunSchema,
} from "@personal-os/domain";
import {
  and,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { AppError } from "../errors.js";
import type { FinanceMaintenanceService } from "../finance-maintenance-service.js";
import type { FinanceStatusService } from "../finance-status-service.js";
import type { Principal } from "../types.js";
import { createWorkspaceMaintenanceService } from "../workspace-maintenance-service.js";
import {
  createLegacyFinanceMaintenanceService,
  legacyMaintenanceScope,
} from "./maintenance-service.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Options = {
  db: Database;
  maintenance: FinanceMaintenanceService;
  status: FinanceStatusService;
  recoverHandoff: (userId: string, runId: string) => Promise<unknown>;
  now: () => Date;
};
const activeStatuses = [
  "queued",
  "running",
  "awaiting_agent_challenge",
  "awaiting_approval",
  "blocked",
  "failed_recoverable",
] as const;

function runValue(row: typeof workspaceMaintenanceRuns.$inferSelect): MaintenanceRun {
  return maintenanceRunSchema.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
    retryAt: row.retryAt?.toISOString() ?? null,
  });
}

/** Intent, legacy lineage and setup linkage; all economic execution belongs to the candidate engine. */
export function createFinanceMaintenanceIntentService({
  db,
  maintenance,
  status,
  recoverHandoff,
  now,
}: Options) {
  const legacyHistory = createLegacyFinanceMaintenanceService({ db });
  function historicalRecovery(
    row: typeof financeMaintenanceRuns.$inferSelect,
  ): FinanceMaintenanceRecovery {
    return (
      row.recovery ?? {
        legacyRunId: row.id,
        originalScope: row.scope,
        originalStage: row.stage,
        state: "historical",
        throughDate: null,
        reason:
          "This historical run is unverified evidence. Start a new canonical run to challenge current ledger evidence; its old terminal stage is not proof of completion.",
      }
    );
  }
  async function lock(tx: Transaction, userId: string) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`finance-maintenance:${userId}`}, 0))`,
    );
  }
  async function ownedRun(tx: Transaction, userId: string, id: string) {
    const [run] = await tx
      .select()
      .from(workspaceMaintenanceRuns)
      .where(
        and(
          eq(workspaceMaintenanceRuns.userId, userId),
          eq(workspaceMaintenanceRuns.domain, "finances"),
          eq(workspaceMaintenanceRuns.id, id),
        ),
      )
      .for("update");
    return run;
  }
  async function reconcileSetup(
    tx: Transaction,
    run: typeof workspaceMaintenanceRuns.$inferSelect,
    attach: boolean,
  ) {
    if (run.scope.type !== "all_outstanding") return;
    if (attach && activeStatuses.includes(run.status as (typeof activeStatuses)[number])) {
      await tx
        .update(financeSetupSessions)
        .set({
          canonicalMaintenanceRunId: run.id,
          updatedAt: now(),
          version: sql`${financeSetupSessions.version} + 1`,
        })
        .where(
          and(
            eq(financeSetupSessions.userId, run.userId),
            eq(financeSetupSessions.status, "initial_maintenance"),
            or(
              isNull(financeSetupSessions.canonicalMaintenanceRunId),
              inArray(
                financeSetupSessions.canonicalMaintenanceRunId,
                tx
                  .select({ id: workspaceMaintenanceRuns.id })
                  .from(workspaceMaintenanceRuns)
                  .where(
                    and(
                      eq(workspaceMaintenanceRuns.userId, run.userId),
                      eq(workspaceMaintenanceRuns.domain, "finances"),
                      inArray(workspaceMaintenanceRuns.status, [
                        "completed_with_questions",
                        "failed_terminal",
                      ]),
                    ),
                  ),
              ),
            ),
          ),
        );
    }
    if (run.status !== "completed") return;
    const steps = await tx
      .select()
      .from(workspaceMaintenanceSteps)
      .where(
        and(
          eq(workspaceMaintenanceSteps.runId, run.id),
          eq(workspaceMaintenanceSteps.status, "completed"),
          inArray(workspaceMaintenanceSteps.stepName, ["verify", "period_review"]),
        ),
      );
    const verification = steps.find((step) => step.stepName === "verify");
    const reviewStep = steps.find((step) => step.stepName === "period_review");
    if (!verification || !reviewStep) return;
    const reviewId = (reviewStep.safeResult as { id?: string } | null)?.id;
    if (!reviewId) return;
    const [review] = await tx
      .select({ id: financePeriodReviews.id })
      .from(financePeriodReviews)
      .where(
        and(
          eq(financePeriodReviews.userId, run.userId),
          eq(financePeriodReviews.runId, run.id),
          eq(financePeriodReviews.id, reviewId),
          eq(financePeriodReviews.status, "completed"),
        ),
      );
    if (!review) return;
    await tx
      .update(financeSetupSessions)
      .set({
        status: "settled",
        updatedAt: now(),
        version: sql`${financeSetupSessions.version} + 1`,
      })
      .where(
        and(
          eq(financeSetupSessions.userId, run.userId),
          eq(financeSetupSessions.status, "initial_maintenance"),
          eq(financeSetupSessions.canonicalMaintenanceRunId, run.id),
        ),
      );
  }
  async function payload(
    userId: string,
    run: MaintenanceRun | null,
    recovery: FinanceMaintenanceRecovery | null = null,
  ): Promise<FinanceMaintenancePayload> {
    let challengeId: string | null = null;
    if (run?.status === "awaiting_agent_challenge") {
      const checkpoint = run.checkpoint as {
        candidateId?: string;
        revision?: string;
        phase?: string;
      } | null;
      if (checkpoint?.phase === "challenge" && checkpoint.candidateId && checkpoint.revision) {
        const [challenge] = await db
          .select({ id: financeLedgerChallenges.id })
          .from(financeLedgerChallenges)
          .innerJoin(
            financeMaintenanceCandidates,
            and(
              eq(financeMaintenanceCandidates.id, financeLedgerChallenges.candidateId),
              eq(financeMaintenanceCandidates.userId, userId),
              eq(financeMaintenanceCandidates.runId, run.id),
              eq(financeMaintenanceCandidates.revision, checkpoint.revision),
              eq(financeMaintenanceCandidates.state, "ready_for_challenge"),
            ),
          )
          .where(
            and(
              eq(financeLedgerChallenges.userId, userId),
              eq(financeLedgerChallenges.runId, run.id),
              eq(financeLedgerChallenges.candidateId, checkpoint.candidateId),
              eq(financeLedgerChallenges.candidateRevision, checkpoint.revision),
              eq(financeLedgerChallenges.state, "prepared"),
            ),
          );
        challengeId = challenge?.id ?? null;
      }
    }
    const nextAction: FinanceMaintenancePayload["nextAction"] = challengeId
      ? {
          tool: "get_finance_ledger_challenge",
          arguments: { challengeId },
          reason:
            "Read every evidence page, then submit complete challenge coverage before settlement.",
        }
      : run && ["queued", "running", "blocked", "failed_recoverable"].includes(run.status)
        ? {
            tool: "maintain_finances",
            arguments: { operation: "resume", runId: run.id },
            reason: "Resume this durable run; committed steps are retained.",
          }
        : null;
    return { run, challengeId, nextAction, recovery };
  }
  function result(data: FinanceMaintenancePayload): FinanceToolResult<FinanceMaintenancePayload> {
    const completed = data.run?.status === "completed";
    const inputRequired =
      !data.run ||
      ["completed_with_questions", "blocked", "awaiting_approval"].includes(data.run.status);
    const failed = data.run?.status === "failed_terminal";
    return {
      schemaVersion: 1,
      data,
      changes: [],
      communication: {
        headline:
          data.recovery?.state === "blocked" || data.recovery?.state === "historical"
            ? data.recovery.reason
            : completed
              ? "Finance maintenance completed with a verified period review."
              : data.run?.status === "completed_with_questions"
                ? "Maintenance finished with unresolved questions; inspect the qualified period review."
                : data.challengeId
                  ? "The Finance candidate is ready for a complete evidence challenge."
                  : "Finance maintenance is saved. Its current state and remaining work are available below.",
        optionalDetails: [],
        requiredDisclosures: [],
      },
      outcome: completed
        ? "completed"
        : failed
          ? "failed"
          : inputRequired
            ? "user_input_required"
            : "work_remaining",
      remainingWork: {
        categories: completed ? [] : ["finance_maintenance"],
        count: completed ? 0 : 1,
      },
      ...(data.nextAction ? { nextAction: data.nextAction } : {}),
    };
  }
  async function resumeBlocked(tx: Transaction, row: typeof workspaceMaintenanceRuns.$inferSelect) {
    if (row.status !== "blocked") return row;
    const observed = await status.getFinanceStatus(row.userId, row.scope, tx);
    if (observed.state === "blocked" || observed.freshness.blockers.length > 0) return row;
    await createWorkspaceMaintenanceService({ db: tx as unknown as Database, now }).requeue({
      runId: row.id,
      expectedStatus: "blocked",
      expectedRulebookVersion: row.rulebookVersion,
    });
    const resumed = await ownedRun(tx, row.userId, row.id);
    if (!resumed) throw new AppError("conflict", "The Finance run changed during recovery.");
    return resumed;
  }
  async function resolveRun(input: FinanceMaintenanceInput, userId: string) {
    return db.transaction(async (tx) => {
      await lock(tx, userId);
      if (input.operation === "start") {
        const observed = await status.getFinanceStatus(userId, input.scope, tx);
        const run = await createWorkspaceMaintenanceService({
          db: tx as unknown as Database,
          now,
        }).createOrResume(userId, "finances", input.scope, observed.details.rulebookVersion);
        const row = await ownedRun(tx, userId, run.id);
        if (!row) throw new AppError("conflict", "The Finance run changed during start.");
        const resumed = await resumeBlocked(tx, row);
        await reconcileSetup(tx, resumed, true);
        return { run: runValue(resumed), recovery: null };
      }
      const current = await ownedRun(tx, userId, input.runId);
      if (current) {
        const resumed = await resumeBlocked(tx, current);
        await reconcileSetup(tx, resumed, true);
        return { run: runValue(resumed), recovery: null };
      }
      const [legacy] = await tx
        .select()
        .from(financeMaintenanceRuns)
        .where(
          and(
            eq(financeMaintenanceRuns.userId, userId),
            eq(financeMaintenanceRuns.id, input.runId),
          ),
        )
        .for("update");
      if (!legacy) throw new AppError("not_found", "The Finance maintenance run was not found.");
      if (legacy.recovery) {
        let adopted = legacy.canonicalRunId
          ? await ownedRun(tx, userId, legacy.canonicalRunId)
          : null;
        if (legacy.canonicalRunId && !adopted)
          throw new AppError(
            "conflict",
            "The adopted Finance run is unavailable; inspect the saved lineage.",
          );
        if (adopted) {
          adopted = await resumeBlocked(tx, adopted);
          await reconcileSetup(tx, adopted, true);
        }
        return {
          run: adopted ? runValue(adopted) : null,
          recovery: legacy.recovery as FinanceMaintenanceRecovery,
        };
      }
      if (["settled", "failed"].includes(legacy.stage))
        return { run: null, recovery: historicalRecovery(legacy) };
      const mapped = legacyMaintenanceScope(legacy.scope, now().toISOString().slice(0, 10));
      // Check each saved account before exposing a repair set or adopting any target.
      if (legacy.scope.type === "accounts") {
        const ids = Array.isArray(legacy.scope.accountIds)
          ? legacy.scope.accountIds.filter((id): id is string => idSchema.safeParse(id).success)
          : [];
        const owned = ids.length
          ? await tx
              .select({ id: financeAccounts.id })
              .from(financeAccounts)
              .where(and(eq(financeAccounts.userId, userId), inArray(financeAccounts.id, ids)))
          : [];
        if (new Set(ids).size !== owned.length)
          throw new AppError("not_found", "A saved Finance account is unavailable.");
      }
      let run: MaintenanceRun | null = null;
      let reason = mapped.reason;
      if (mapped.scope) {
        const observed = await status.getFinanceStatus(userId, mapped.scope, tx);
        const open = await tx
          .select()
          .from(workspaceMaintenanceRuns)
          .where(
            and(
              eq(workspaceMaintenanceRuns.userId, userId),
              eq(workspaceMaintenanceRuns.domain, "finances"),
              inArray(workspaceMaintenanceRuns.status, activeStatuses),
            ),
          );
        if (open.length && !isDeepStrictEqual(open[0]?.scope, mapped.scope)) {
          reason =
            "A different Finance scope is already active. Finish that run, then start the exact saved scope shown in this lineage. No broader work was adopted.";
        } else {
          run = await createWorkspaceMaintenanceService({
            db: tx as unknown as Database,
            now,
          }).createOrResume(userId, "finances", mapped.scope, observed.details.rulebookVersion);
        }
      }
      const recovery = {
        legacyRunId: legacy.id,
        state: run ? ("adopted" as const) : ("blocked" as const),
        originalScope: legacy.scope,
        originalStage: legacy.stage,
        throughDate: mapped.throughDate,
        reason,
      };
      await tx
        .update(financeMaintenanceRuns)
        .set({
          canonicalRunId: run?.id ?? null,
          recovery,
          stage: "superseded",
          updatedAt: now(),
          version: legacy.version + 1,
        })
        .where(eq(financeMaintenanceRuns.id, legacy.id));
      if (run) {
        const row = await ownedRun(tx, userId, run.id);
        if (row) {
          const resumed = await resumeBlocked(tx, row);
          run = runValue(resumed);
          await reconcileSetup(tx, resumed, true);
        }
      }
      return { run, recovery };
    });
  }
  return {
    async maintainFinances(input: FinanceMaintenanceInput, principal: Principal) {
      if (!principal.scopes.has("finances:maintain"))
        throw new AppError(
          "forbidden",
          "Reconnect and explicitly authorize finances:maintain to run Finance maintenance.",
        );
      const resolved = await resolveRun(
        financeMaintenanceInputSchema.parse(input),
        principal.userId,
      );
      if (!resolved.run) return result(await payload(principal.userId, null, resolved.recovery));
      const runId = resolved.run.id;
      await recoverHandoff(principal.userId, runId);
      await maintenance.dispatchRun(runId);
      const run = await db.transaction(async (tx) => {
        await lock(tx, principal.userId);
        const row = await ownedRun(tx, principal.userId, runId);
        if (!row) throw new AppError("not_found", "The Finance maintenance run was not found.");
        await reconcileSetup(tx, row, false);
        return runValue(row);
      });
      return result(await payload(principal.userId, run, resolved.recovery));
    },
    async getRun(userId: string, id: string) {
      const run = await db.transaction(async (tx) => {
        const row = await ownedRun(tx, userId, id);
        return row ? runValue(row) : null;
      });
      if (!run)
        return payload(userId, null, historicalRecovery(await legacyHistory.getRun(userId, id)));
      return payload(userId, run);
    },
    async history(userId: string, query: FinanceMaintenanceHistoryQuery) {
      const cursorId = query.cursor ? idSchema.parse(query.cursor) : null;
      const cursor = cursorId
        ? ((await db.query.workspaceMaintenanceRuns.findFirst({
            where: and(
              eq(workspaceMaintenanceRuns.id, cursorId),
              eq(workspaceMaintenanceRuns.userId, userId),
              eq(workspaceMaintenanceRuns.domain, "finances"),
            ),
          })) ??
          (await db.query.financeMaintenanceRuns.findFirst({
            where: and(
              eq(financeMaintenanceRuns.id, cursorId),
              eq(financeMaintenanceRuns.userId, userId),
            ),
          })))
        : null;
      if (query.cursor && !cursor)
        throw new AppError("not_found", "The Finance history cursor was not found.");
      // Keep PostgreSQL microseconds through pagination; JS Date truncates them.
      const cursorTime = cursorId
        ? sql`(SELECT created_at FROM workspace_maintenance_runs WHERE id = ${cursorId} AND user_id = ${userId} AND domain = 'finances' UNION ALL SELECT created_at FROM finance_maintenance_runs WHERE id = ${cursorId} AND user_id = ${userId} LIMIT 1)`
        : null;
      const rows = await db
        .select({
          ...getTableColumns(workspaceMaintenanceRuns),
          sortTimestamp: sql<string>`to_char(${workspaceMaintenanceRuns.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US')`,
        })
        .from(workspaceMaintenanceRuns)
        .where(
          and(
            eq(workspaceMaintenanceRuns.userId, userId),
            eq(workspaceMaintenanceRuns.domain, "finances"),
            query.status ? eq(workspaceMaintenanceRuns.status, query.status) : undefined,
            cursor && cursorTime
              ? or(
                  lt(workspaceMaintenanceRuns.createdAt, cursorTime),
                  and(
                    eq(workspaceMaintenanceRuns.createdAt, cursorTime),
                    lt(workspaceMaintenanceRuns.id, cursor.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(desc(workspaceMaintenanceRuns.createdAt), desc(workspaceMaintenanceRuns.id))
        .limit(query.limit + 1);
      const legacy = query.status
        ? []
        : await db
            .select({
              ...getTableColumns(financeMaintenanceRuns),
              sortTimestamp: sql<string>`to_char(${financeMaintenanceRuns.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US')`,
            })
            .from(financeMaintenanceRuns)
            .where(
              and(
                eq(financeMaintenanceRuns.userId, userId),
                cursor && cursorTime
                  ? or(
                      lt(financeMaintenanceRuns.createdAt, cursorTime),
                      and(
                        eq(financeMaintenanceRuns.createdAt, cursorTime),
                        lt(financeMaintenanceRuns.id, cursor.id),
                      ),
                    )
                  : undefined,
              ),
            )
            .orderBy(desc(financeMaintenanceRuns.createdAt), desc(financeMaintenanceRuns.id))
            .limit(query.limit + 1);
      const all = [
        ...rows.map((row) => ({
          id: row.id,
          sortTimestamp: row.sortTimestamp,
          value: () => payload(userId, runValue(row)),
        })),
        ...legacy.map((row) => ({
          id: row.id,
          sortTimestamp: row.sortTimestamp,
          value: () => payload(userId, null, historicalRecovery(row)),
        })),
      ].sort(
        (a, b) =>
          (a.sortTimestamp < b.sortTimestamp ? 1 : a.sortTimestamp > b.sortTimestamp ? -1 : 0) ||
          (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
      );
      const page = all.slice(0, query.limit);
      return {
        items: await Promise.all(page.map((row) => row.value())),
        nextCursor: all.length > query.limit ? (page.at(-1)?.id ?? null) : null,
      };
    },
    async recoverAcceptedWork(limit = 5) {
      const rows = await db
        .selectDistinct({
          userId: workspaceMaintenanceRuns.userId,
          id: workspaceMaintenanceRuns.id,
          updatedAt: workspaceMaintenanceRuns.updatedAt,
          attemptTimestamp: sql<string>`${workspaceMaintenanceRuns.updatedAt}::text`,
        })
        .from(workspaceMaintenanceRuns)
        .innerJoin(
          financeLedgerChallenges,
          and(
            eq(financeLedgerChallenges.runId, workspaceMaintenanceRuns.id),
            eq(financeLedgerChallenges.userId, workspaceMaintenanceRuns.userId),
            eq(financeLedgerChallenges.state, "resolved"),
            sql`${financeLedgerChallenges.candidateId}::text = ${workspaceMaintenanceRuns.checkpoint}->>'candidateId'`,
            sql`${financeLedgerChallenges.candidateRevision} = ${workspaceMaintenanceRuns.checkpoint}->>'revision'`,
          ),
        )
        .innerJoin(
          financeMaintenanceCandidates,
          and(
            eq(financeMaintenanceCandidates.id, financeLedgerChallenges.candidateId),
            eq(financeMaintenanceCandidates.userId, workspaceMaintenanceRuns.userId),
            eq(financeMaintenanceCandidates.runId, workspaceMaintenanceRuns.id),
            eq(financeMaintenanceCandidates.revision, financeLedgerChallenges.candidateRevision),
            eq(financeMaintenanceCandidates.state, "challenged"),
          ),
        )
        .innerJoin(
          workspaceMaintenanceSteps,
          and(
            eq(workspaceMaintenanceSteps.runId, workspaceMaintenanceRuns.id),
            eq(workspaceMaintenanceSteps.stepName, "challenge_resolve"),
            eq(workspaceMaintenanceSteps.status, "completed"),
            sql`${workspaceMaintenanceSteps.safeResult}->>'candidateId' = ${financeMaintenanceCandidates.id}::text`,
            sql`${workspaceMaintenanceSteps.safeResult}->>'candidateRevision' = ${financeMaintenanceCandidates.revision}`,
            sql`${workspaceMaintenanceSteps.safeResult}->>'questions' = '0'`,
          ),
        )
        .where(
          and(
            sql`${workspaceMaintenanceRuns.checkpoint}->>'phase' = 'challenge'`,
            eq(workspaceMaintenanceRuns.domain, "finances"),
            eq(workspaceMaintenanceRuns.status, "awaiting_agent_challenge"),
          ),
        )
        .orderBy(workspaceMaintenanceRuns.updatedAt)
        .limit(limit);
      const recovery = await Promise.allSettled(
        rows.map(async (row) => {
          try {
            return await recoverHandoff(row.userId, row.id);
          } catch (error) {
            // Rotate failing handoffs behind untouched work and retain a safe repair signal.
            await db.transaction(async (tx) => {
              await lock(tx, row.userId);
              await tx
                .update(workspaceMaintenanceRuns)
                .set({
                  updatedAt: sql`GREATEST(NOW(), ${workspaceMaintenanceRuns.updatedAt} + INTERVAL '1 microsecond')`,
                  lastSafeError: {
                    code: "finance_handoff_recovery_failed",
                    message:
                      "The accepted Finance handoff could not be recovered. Resume the run to retry; later runs can still progress.",
                  },
                })
                .where(
                  and(
                    eq(workspaceMaintenanceRuns.id, row.id),
                    eq(workspaceMaintenanceRuns.userId, row.userId),
                    eq(workspaceMaintenanceRuns.status, "awaiting_agent_challenge"),
                    sql`${workspaceMaintenanceRuns.updatedAt} = ${row.attemptTimestamp}::timestamptz`,
                  ),
                );
            });
            throw error;
          }
        }),
      );
      const sessions = await db
        .select({
          userId: financeSetupSessions.userId,
          runId: financeSetupSessions.canonicalMaintenanceRunId,
        })
        .from(financeSetupSessions)
        .innerJoin(
          workspaceMaintenanceRuns,
          eq(workspaceMaintenanceRuns.id, financeSetupSessions.canonicalMaintenanceRunId),
        )
        .where(
          and(
            eq(financeSetupSessions.status, "initial_maintenance"),
            isNotNull(financeSetupSessions.canonicalMaintenanceRunId),
            eq(workspaceMaintenanceRuns.status, "completed"),
          ),
        )
        .limit(100);
      for (const session of sessions)
        if (session.runId) {
          const runId = session.runId;
          await db.transaction(async (tx) => {
            await lock(tx, session.userId);
            const row = await ownedRun(tx, session.userId, runId);
            if (row) await reconcileSetup(tx, row, false);
          });
        }
      return { failedRecoveries: recovery.filter((item) => item.status === "rejected").length };
    },
  };
}
