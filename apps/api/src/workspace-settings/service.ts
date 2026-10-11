import {
  auditEvents,
  calendarWorkspaceSettings,
  type Database,
  financeAccounts,
  financesWorkspaceSettings,
  mailWorkspaceSettings,
  taskLists,
  taskProjects,
  tasksWorkspaceSettings,
} from "@personal-os/database";
import {
  resolveWorkspaceSettings,
  type Workspace,
  type WorkspaceSettings,
  workspaceSettingsUpdateSchemas,
} from "@personal-os/domain";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { auditValues } from "../audit.js";
import { AppError } from "../errors.js";
import { assertSettingsRevision, type SettingsMutationContext } from "../settings-save.js";

const tables = {
  calendar: calendarWorkspaceSettings,
  tasks: tasksWorkspaceSettings,
  mail: mailWorkspaceSettings,
  finances: financesWorkspaceSettings,
};
export function createWorkspaceSettingsService(db: Database) {
  const read = async <W extends Workspace>(
    database: Database,
    userId: string,
    workspace: W,
  ): Promise<WorkspaceSettings<W>> => {
    const table = tables[workspace as Workspace];
    const [row] = await database.select().from(table).where(eq(table.userId, userId));
    return resolveWorkspaceSettings(workspace, row);
  };
  return {
    get: <W extends Workspace>(userId: string, workspace: W) => read(db, userId, workspace),
    async update<W extends Workspace>(
      workspace: W,
      value: unknown,
      context: SettingsMutationContext,
    ): Promise<WorkspaceSettings<W>> {
      if (context.principal.actorType !== "user")
        throw new AppError("forbidden", "Workspace preferences require an interactive user.");
      const parsed = workspaceSettingsUpdateSchemas[workspace].safeParse(value);
      if (!parsed.success)
        throw new AppError(
          "invalid_request",
          "Preferences must be valid and belong to this workspace.",
        );
      const input = parsed.data;
      return db.transaction(async (tx) => {
        const userId = context.principal.userId;
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`workspace-settings:${workspace}:${userId}`}, 0))`,
        );
        const table = tables[workspace as Workspace];
        const [row] = await tx.select().from(table).where(eq(table.userId, userId));
        const revision = row?.revision ?? 0;
        assertSettingsRevision(
          revision,
          input.expectedRevision,
          "These preferences changed. Reload and try again.",
        );
        const resolved = resolveWorkspaceSettings(workspace, { ...row, ...input.preferences });
        if (resolved.workspace === "tasks") {
          const changes = workspaceSettingsUpdateSchemas.tasks.parse(value).preferences;
          for (const [ids, source] of [
            [changes.pinnedListIds, taskLists],
            [changes.pinnedProjectIds, taskProjects],
          ] as const) {
            if (!ids?.length) continue;
            const owned = await tx
              .select({ id: source.id })
              .from(source)
              .where(and(eq(source.userId, userId), inArray(source.id, ids)));
            if (owned.length !== ids.length)
              throw new AppError(
                "invalid_request",
                "Pins must reference your own lists and projects.",
              );
          }
          if (changes.defaultCaptureListId) {
            const [list] = await tx
              .select({ id: taskLists.id })
              .from(taskLists)
              .where(
                and(
                  eq(taskLists.userId, userId),
                  eq(taskLists.id, changes.defaultCaptureListId),
                  eq(taskLists.availability, "active"),
                  isNull(taskLists.deletedAt),
                ),
              );
            if (!list)
              throw new AppError(
                "invalid_request",
                "Choose one of your active lists as the default capture list.",
              );
          }
        }
        if (resolved.workspace === "finances") {
          const changes = workspaceSettingsUpdateSchemas.finances.parse(value).preferences;
          for (const [key, kind] of [
            ["spendAccountIds", null],
            ["cashAccountIds", "cash"],
            ["investmentAccountIds", "investment"],
          ] as const) {
            const ids = changes[key];
            if (!ids?.length) continue;
            const owned = await tx
              .select({ id: financeAccounts.id })
              .from(financeAccounts)
              .where(
                and(
                  eq(financeAccounts.userId, userId),
                  inArray(financeAccounts.id, ids),
                  kind ? eq(financeAccounts.kind, kind) : undefined,
                ),
              );
            if (owned.length !== ids.length)
              throw new AppError(
                "invalid_request",
                "Choose your own eligible accounts for this view.",
              );
          }
        }
        const common = { userId, revision: revision + 1, updatedAt: new Date() };
        // Narrowing on the discriminator keeps each persisted shape domain-owned.
        switch (resolved.workspace) {
          case "calendar": {
            const values = { ...common, ...resolved.preferences };
            await tx
              .insert(calendarWorkspaceSettings)
              .values(values)
              .onConflictDoUpdate({ target: calendarWorkspaceSettings.userId, set: values });
            break;
          }
          case "tasks": {
            const values = { ...common, ...resolved.preferences };
            await tx
              .insert(tasksWorkspaceSettings)
              .values(values)
              .onConflictDoUpdate({ target: tasksWorkspaceSettings.userId, set: values });
            break;
          }
          case "mail": {
            const values = { ...common, ...resolved.preferences };
            await tx
              .insert(mailWorkspaceSettings)
              .values(values)
              .onConflictDoUpdate({ target: mailWorkspaceSettings.userId, set: values });
            break;
          }
          case "finances": {
            const values = { ...common, ...resolved.preferences };
            await tx
              .insert(financesWorkspaceSettings)
              .values(values)
              .onConflictDoUpdate({ target: financesWorkspaceSettings.userId, set: values });
            break;
          }
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
        return resolveWorkspaceSettings(workspace, persisted);
      });
    },
  };
}
