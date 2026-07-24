import { auditEvents, type Database } from "@personal-os/database";
import type { ActorType } from "@personal-os/domain";
import { desc, eq } from "drizzle-orm";

type AuditPrincipal = {
  actorId: string;
  actorType: ActorType;
  userId: string;
};

export type AuditMutation = {
  action: string;
  after: Record<string, unknown> | null;
  before: Record<string, unknown> | null;
  entityId: string;
  entityType: string;
  principal: AuditPrincipal;
  requestId: string;
};

export function auditValues(input: AuditMutation): typeof auditEvents.$inferInsert {
  return {
    action: input.action,
    actorId: input.principal.actorId,
    actorType: input.principal.actorType,
    after: input.after,
    before: input.before,
    entityId: input.entityId,
    entityType: input.entityType,
    requestId: input.requestId,
    userId: input.principal.userId,
  };
}

export function createAuditService(db: Database) {
  return {
    async list(userId: string, limit: number) {
      const records = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.userId, userId))
        .orderBy(desc(auditEvents.createdAt))
        .limit(limit);
      return records.map((record) => ({
        action: record.action,
        actorId: record.actorId,
        actorType: record.actorType,
        after: record.after,
        before: record.before,
        createdAt: record.createdAt.toISOString(),
        entityId: record.entityId,
        entityType: record.entityType,
        id: record.id,
        requestId: record.requestId,
      }));
    },
  };
}
