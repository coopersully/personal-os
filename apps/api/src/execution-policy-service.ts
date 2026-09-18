import { auditEvents, type Database, executionPolicySettings } from "@personal-os/database";
import type {
  ExecutionPolicySettings,
  UpdateExecutionPolicySettingsInput,
} from "@personal-os/domain";
import { eq, sql } from "drizzle-orm";
import { auditValues } from "./audit.js";
import { AppError } from "./errors.js";
import type { Principal } from "./types.js";

type MutationContext = { principal: Principal; requestId: string };

function serialize(
  row: Pick<typeof executionPolicySettings.$inferSelect, "reviewBypassEnabled" | "version">,
): ExecutionPolicySettings {
  return { reviewBypassEnabled: row.reviewBypassEnabled, version: row.version };
}

export function createExecutionPolicyService(input: { db: Database; now: () => Date }) {
  return {
    async get(userId: string): Promise<ExecutionPolicySettings> {
      const row = await input.db.query.executionPolicySettings.findFirst({
        where: eq(executionPolicySettings.userId, userId),
      });
      return row ? serialize(row) : { reviewBypassEnabled: false, version: 1 };
    },

    async update(
      update: UpdateExecutionPolicySettingsInput,
      context: MutationContext,
    ): Promise<ExecutionPolicySettings> {
      if (context.principal.actorType !== "user") {
        throw new AppError("forbidden", "Execution policy changes require an interactive user.");
      }
      return input.db.transaction(async (tx) => {
        const userId = context.principal.userId;
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`execution-policy:${userId}`}, 0))`,
        );
        const existing = await tx.query.executionPolicySettings.findFirst({
          where: eq(executionPolicySettings.userId, userId),
        });
        const before = existing ? serialize(existing) : { reviewBypassEnabled: false, version: 1 };
        if (before.version !== update.expectedVersion) {
          throw new AppError("conflict", "Execution policy changed. Refresh and try again.", {
            currentVersion: before.version,
          });
        }
        if (before.reviewBypassEnabled === update.reviewBypassEnabled) return before;

        const next = {
          reviewBypassEnabled: update.reviewBypassEnabled,
          version: before.version + 1,
        };
        const [saved] = await tx
          .insert(executionPolicySettings)
          .values({ ...next, updatedAt: input.now(), userId })
          .onConflictDoUpdate({
            set: { ...next, updatedAt: input.now() },
            target: executionPolicySettings.userId,
          })
          .returning();
        if (!saved) throw new AppError("internal_error", "Execution policy was not saved.");
        await tx.insert(auditEvents).values(
          auditValues({
            action: "execution_policy.review_bypass_updated",
            after: next,
            before,
            entityId: userId,
            entityType: "execution_policy_settings",
            principal: context.principal,
            requestId: context.requestId,
          }),
        );
        return serialize(saved);
      });
    },
  };
}
