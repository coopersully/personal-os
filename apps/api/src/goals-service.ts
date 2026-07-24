import { auditEvents, type Database, goals, motives } from "@personal-os/database";
import type {
  CreateGoalInput,
  CreateMotiveInput,
  Goal,
  Motive,
  UpdateGoalInput,
  UpdateMotiveInput,
} from "@personal-os/domain";
import { and, asc, desc, eq } from "drizzle-orm";
import { auditValues } from "./audit.js";
import { requireDatabaseRecord } from "./database.js";
import { AppError } from "./errors.js";
import type { Principal } from "./types.js";

type MutationContext = { principal: Principal; requestId: string };
type Options = { db: Database; now: () => Date };

export function createGoalsService({ db, now }: Options) {
  async function findGoal(id: string, userId: string) {
    const [goal] = await db
      .select()
      .from(goals)
      .where(and(eq(goals.id, id), eq(goals.userId, userId)));
    if (!goal) throw new AppError("not_found", "The goal was not found.");
    return goal;
  }
  async function findMotive(id: string, userId: string) {
    const [motive] = await db
      .select()
      .from(motives)
      .where(and(eq(motives.id, id), eq(motives.userId, userId)));
    if (!motive) throw new AppError("not_found", "The motive was not found.");
    return motive;
  }
  return {
    async listGoals(userId: string): Promise<Goal[]> {
      return (
        await db
          .select()
          .from(goals)
          .where(eq(goals.userId, userId))
          .orderBy(asc(goals.status), asc(goals.targetDate), desc(goals.createdAt))
      ).map(serializeGoal);
    },
    async createGoal(input: CreateGoalInput, context: MutationContext): Promise<Goal> {
      const row = await db.transaction(async (tx) => {
        const created = requireDatabaseRecord(
          (
            await tx
              .insert(goals)
              .values({ ...input, userId: context.principal.userId })
              .returning()
          )[0],
          "The goal could not be created.",
        );
        await tx.insert(auditEvents).values(
          auditValues({
            action: "goal.created",
            after: serializeGoal(created),
            before: null,
            entityId: created.id,
            entityType: "goal",
            ...context,
          }),
        );
        return created;
      });
      return serializeGoal(row);
    },
    async updateGoal(id: string, input: UpdateGoalInput, context: MutationContext): Promise<Goal> {
      const before = await findGoal(id, context.principal.userId);
      const row = await db.transaction(async (tx) => {
        const updated = requireDatabaseRecord(
          (
            await tx
              .update(goals)
              .set({ ...input, updatedAt: now() })
              .where(eq(goals.id, before.id))
              .returning()
          )[0],
          "The goal could not be updated.",
        );
        await tx.insert(auditEvents).values(
          auditValues({
            action: "goal.updated",
            after: serializeGoal(updated),
            before: serializeGoal(before),
            entityId: updated.id,
            entityType: "goal",
            ...context,
          }),
        );
        return updated;
      });
      return serializeGoal(row);
    },
    async deleteGoal(id: string, context: MutationContext): Promise<void> {
      const before = await findGoal(id, context.principal.userId);
      await db.transaction(async (tx) => {
        await tx.delete(goals).where(eq(goals.id, before.id));
        await tx.insert(auditEvents).values(
          auditValues({
            action: "goal.deleted",
            after: null,
            before: serializeGoal(before),
            entityId: before.id,
            entityType: "goal",
            ...context,
          }),
        );
      });
    },
    async listMotives(userId: string): Promise<Motive[]> {
      return (
        await db
          .select()
          .from(motives)
          .where(eq(motives.userId, userId))
          .orderBy(desc(motives.isActive), desc(motives.createdAt))
      ).map(serializeMotive);
    },
    async createMotive(input: CreateMotiveInput, context: MutationContext): Promise<Motive> {
      const row = await db.transaction(async (tx) => {
        const created = requireDatabaseRecord(
          (
            await tx
              .insert(motives)
              .values({ ...input, userId: context.principal.userId })
              .returning()
          )[0],
          "The motive could not be created.",
        );
        await tx.insert(auditEvents).values(
          auditValues({
            action: "motive.created",
            after: serializeMotive(created),
            before: null,
            entityId: created.id,
            entityType: "motive",
            ...context,
          }),
        );
        return created;
      });
      return serializeMotive(row);
    },
    async updateMotive(
      id: string,
      input: UpdateMotiveInput,
      context: MutationContext,
    ): Promise<Motive> {
      const before = await findMotive(id, context.principal.userId);
      const row = await db.transaction(async (tx) => {
        const updated = requireDatabaseRecord(
          (
            await tx
              .update(motives)
              .set({ ...input, updatedAt: now() })
              .where(eq(motives.id, before.id))
              .returning()
          )[0],
          "The motive could not be updated.",
        );
        await tx.insert(auditEvents).values(
          auditValues({
            action: "motive.updated",
            after: serializeMotive(updated),
            before: serializeMotive(before),
            entityId: updated.id,
            entityType: "motive",
            ...context,
          }),
        );
        return updated;
      });
      return serializeMotive(row);
    },
    async deleteMotive(id: string, context: MutationContext): Promise<void> {
      const before = await findMotive(id, context.principal.userId);
      await db.transaction(async (tx) => {
        await tx.delete(motives).where(eq(motives.id, before.id));
        await tx.insert(auditEvents).values(
          auditValues({
            action: "motive.deleted",
            after: null,
            before: serializeMotive(before),
            entityId: before.id,
            entityType: "motive",
            ...context,
          }),
        );
      });
    },
  };
}

function serializeGoal(row: typeof goals.$inferSelect): Goal {
  return {
    createdAt: row.createdAt.toISOString(),
    description: row.description,
    id: row.id,
    progress: row.progress,
    status: row.status,
    targetDate: row.targetDate,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
  };
}
function serializeMotive(row: typeof motives.$inferSelect): Motive {
  return {
    createdAt: row.createdAt.toISOString(),
    detail: row.detail,
    id: row.id,
    isActive: row.isActive,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
  };
}
