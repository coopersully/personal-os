import { accessTokens, type Database, executionPolicySettings } from "@personal-os/database";
import { eq } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import { AppError } from "./errors.js";
import type { AppEnv, Principal } from "./types.js";

export type ExecutableWorkspace = "mail" | "finances" | "calendar" | "tasks" | "texting";
type Executor = Pick<Database, "select">;

/** Standing owner consent is independent of effect reversibility and never supplied by a caller. */
export async function requireWorkspaceExecution(
  db: Executor,
  principal: Principal,
  workspace: ExecutableWorkspace,
  at?: Date,
): Promise<void> {
  if (principal.actorType === "user") return;
  if (
    !principal.scopes.has(`${workspace}:write`) ||
    !principal.scopes.has(`${workspace}:execute`)
  ) {
    throw new AppError(
      "forbidden",
      `This operation requires ${workspace}:write and explicit ${workspace}:execute access.`,
    );
  }
  const [grant] = await db
    .select()
    .from(accessTokens)
    .where(eq(accessTokens.id, principal.actorId))
    .for("share")
    .limit(1);
  if (
    !grant ||
    grant.userId !== principal.userId ||
    grant.revokedAt ||
    (at !== undefined && grant.expiresAt !== null && grant.expiresAt <= at) ||
    !grant.scopes.includes(`${workspace}:write`) ||
    !grant.scopes.includes(`${workspace}:execute`)
  )
    throw new AppError("forbidden", "The execution grant is no longer active.");
  const [policy] = await db
    .select()
    .from(executionPolicySettings)
    .where(eq(executionPolicySettings.userId, principal.userId))
    .for("share")
    .limit(1);
  if (!policy?.reviewBypassEnabled)
    throw new AppError(
      "forbidden",
      "This operation requires the owner's review bypass to be enabled.",
    );
}

export function requireWorkspaceExecutionRoute(
  db: Executor | undefined,
  workspace: ExecutableWorkspace,
): MiddlewareHandler<AppEnv> {
  return async (context, next) => {
    if (context.get("principal").actorType !== "user") {
      if (!db) throw new AppError("forbidden", "Workspace execution authority is unavailable.");
      await requireWorkspaceExecution(db, context.get("principal"), workspace);
    }
    await next();
  };
}

/** A connected account can supply Mail, Calendar and Reminders together. */
export async function requireWorkspaceSourceExecution(
  db: Executor,
  principal: Principal,
  at: Date,
) {
  if (principal.actorType === "user") return;
  if (!principal.scopes.has("reminders:write"))
    throw new AppError("forbidden", "Shared source changes require reminders:write access.");
  for (const workspace of ["mail", "calendar", "tasks"] as const)
    await requireWorkspaceExecution(db, principal, workspace, at);
}
