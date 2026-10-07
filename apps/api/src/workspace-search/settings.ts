import {
  auditEvents,
  calendarWorkspaceSettings,
  type Database,
  financesWorkspaceSettings,
  mailWorkspaceSettings,
  taskLists,
  taskProjects,
  tasksWorkspaceSettings,
} from "@personal-os/database";
import {
  type SearchableWorkspace,
  type UpdateWorkspaceSettings,
  type WorkspaceSettings,
  workspacePreferencesSchema,
} from "@personal-os/domain";
import { and, eq, inArray, sql } from "drizzle-orm";
import { auditValues } from "../audit.js";
import { AppError } from "../errors.js";
import type { Principal } from "../types.js";

const tables = {
  calendar: calendarWorkspaceSettings,
  tasks: tasksWorkspaceSettings,
  mail: mailWorkspaceSettings,
  finances: financesWorkspaceSettings,
};
export function createWorkspaceSettingsService(db: Database) {
  const read = async (
    database: Database,
    userId: string,
    workspace: SearchableWorkspace,
  ): Promise<WorkspaceSettings> => {
    const table = tables[workspace];
    const [row] = await database.select().from(table).where(eq(table.userId, userId));
    return {
      workspace,
      revision: row?.revision ?? 0,
      preferences: workspacePreferencesSchema.parse(row ?? {}),
    };
  };
  return {
    get: (userId: string, workspace: SearchableWorkspace) => read(db, userId, workspace),
    async update(
      workspace: SearchableWorkspace,
      input: UpdateWorkspaceSettings,
      context: { principal: Principal; requestId: string },
    ): Promise<WorkspaceSettings> {
      if (context.principal.actorType !== "user")
        throw new AppError("forbidden", "Workspace preferences require an interactive user.");
      if (
        workspace !== "calendar" &&
        (input.preferences.calendarView !== undefined ||
          input.preferences.showWeekends !== undefined ||
          input.preferences.autoFollowToday !== undefined ||
          input.preferences.snapToFollow !== undefined ||
          input.preferences.followSnapSensitivity !== undefined)
      )
        throw new AppError("invalid_request", "Calendar preferences belong to Calendar.");
      if (
        workspace !== "tasks" &&
        (input.preferences.taskSort !== undefined ||
          input.preferences.taskGroup !== undefined ||
          input.preferences.taskRowDetails !== undefined ||
          input.preferences.taskContainerSort !== undefined ||
          input.preferences.pinnedListIds !== undefined ||
          input.preferences.pinnedProjectIds !== undefined)
      )
        throw new AppError("invalid_request", "Task preferences belong to Tasks.");
      if (
        workspace !== "mail" &&
        (input.preferences.mailConversationLayout !== undefined ||
          input.preferences.mailListDensity !== undefined ||
          input.preferences.mailListWidth !== undefined)
      )
        throw new AppError("invalid_request", "Mail layout preferences belong to Mail.");
      if (
        workspace !== "finances" &&
        (input.preferences.financeTransactionView !== undefined ||
          input.preferences.financeTransactionGroup !== undefined)
      )
        throw new AppError("invalid_request", "Finance display preferences belong to Finances.");
      return db.transaction(async (tx) => {
        const userId = context.principal.userId;
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`workspace-settings:${workspace}:${userId}`}, 0))`,
        );
        const table = tables[workspace];
        const [row] = await tx.select().from(table).where(eq(table.userId, userId));
        const revision = row?.revision ?? 0;
        if (revision !== input.expectedRevision)
          throw new AppError("conflict", "These preferences changed. Reload and try again.");
        const preferences = workspacePreferencesSchema.parse({ ...row, ...input.preferences });
        if (workspace === "tasks") {
          for (const [ids, table] of [
            [input.preferences.pinnedListIds, taskLists],
            [input.preferences.pinnedProjectIds, taskProjects],
          ] as const) {
            if (!ids?.length) continue;
            const owned = await tx
              .select({ id: table.id })
              .from(table)
              .where(and(eq(table.userId, userId), inArray(table.id, ids)));
            if (new Set(ids).size !== ids.length || owned.length !== ids.length)
              throw new AppError(
                "invalid_request",
                "Pins must reference your own lists and projects.",
              );
          }
        }
        const common = {
          includeArchivedInSearch: preferences.includeArchivedInSearch,
          revision: revision + 1,
          updatedAt: new Date(),
        };
        if (workspace === "calendar") {
          const values = {
            ...common,
            calendarView: preferences.calendarView,
            showWeekends: preferences.showWeekends,
            autoFollowToday: preferences.autoFollowToday,
            snapToFollow: preferences.snapToFollow,
            followSnapSensitivity: preferences.followSnapSensitivity,
          };
          await tx
            .insert(calendarWorkspaceSettings)
            .values({ userId, ...values })
            .onConflictDoUpdate({ target: calendarWorkspaceSettings.userId, set: values });
        } else if (workspace === "tasks") {
          const values = {
            ...common,
            taskSort: preferences.taskSort ?? "default",
            taskGroup: preferences.taskGroup ?? "none",
            taskRowDetails: preferences.taskRowDetails ?? ["estimate"],
            taskContainerSort: preferences.taskContainerSort ?? "updated",
            pinnedListIds: preferences.pinnedListIds,
            pinnedProjectIds: preferences.pinnedProjectIds,
          };
          await tx
            .insert(tasksWorkspaceSettings)
            .values({ userId, ...values })
            .onConflictDoUpdate({ target: tasksWorkspaceSettings.userId, set: values });
        } else if (workspace === "mail") {
          const values = {
            ...common,
            mailConversationLayout: preferences.mailConversationLayout ?? "split",
            mailListDensity: preferences.mailListDensity ?? "comfortable",
            mailListWidth: preferences.mailListWidth ?? 34,
          };
          await tx
            .insert(mailWorkspaceSettings)
            .values({ userId, ...values })
            .onConflictDoUpdate({ target: mailWorkspaceSettings.userId, set: values });
        } else {
          const values = {
            ...common,
            financeTransactionView: preferences.financeTransactionView ?? "table",
            financeTransactionGroup: preferences.financeTransactionGroup ?? "none",
          };
          await tx
            .insert(financesWorkspaceSettings)
            .values({ userId, ...values })
            .onConflictDoUpdate({ target: financesWorkspaceSettings.userId, set: values });
        }
        const [persisted] = await tx.select().from(table).where(eq(table.userId, userId));
        await tx.insert(auditEvents).values(
          auditValues({
            action: "workspace.preferences_updated",
            before: row ?? null,
            after: persisted ?? null,
            entityId: userId,
            entityType: `${workspace}_workspace_settings`,
            ...context,
          }),
        );
        return { workspace, revision: revision + 1, preferences };
      });
    },
  };
}
