import { randomUUID } from "node:crypto";
import {
  accessTokens,
  agentAccountConnections,
  agentAccounts,
  auditEvents,
  type Database,
} from "@personal-os/database";
import {
  type AgentAccount,
  type AgentAccountDirectory,
  type AgentPlatform,
  agentAccountLinkSchema,
  agentAccountRegistrationSchema,
  agentAccountUpdateSchema,
  generatedAgentName,
} from "@personal-os/domain";
import { and, eq, sql } from "drizzle-orm";
import { activeHostConnectionGrant } from "./automation-host-grant.js";
import { AppError } from "./errors.js";
import type { Principal } from "./types.js";

type Executor = Pick<Database, "select" | "insert" | "update" | "execute">;
const serialize = (row: typeof agentAccounts.$inferSelect): AgentAccount => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
const human = (p: Principal) => {
  if (p.actorType !== "user" || p.actorId !== p.userId)
    throw new AppError("forbidden", "Only you can manage agent account identities.");
};
export async function findAgentAccount(
  db: Executor,
  userId: string,
  connectionId: string,
): Promise<AgentAccount | null> {
  const [row] = await db
    .select({ account: agentAccounts })
    .from(agentAccountConnections)
    .innerJoin(
      agentAccounts,
      and(
        eq(agentAccounts.id, agentAccountConnections.agentAccountId),
        eq(agentAccounts.userId, agentAccountConnections.userId),
      ),
    )
    .where(
      and(
        eq(agentAccountConnections.userId, userId),
        eq(agentAccountConnections.authorizationConnectionId, connectionId),
      ),
    )
    .limit(1);
  return row ? serialize(row.account) : null;
}
async function lockConnection(db: Executor, userId: string, connectionId: string) {
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`agent-account:${userId}:${connectionId}`}, 0))`,
  );
}
/** Caller has already authenticated this connection; serialized against explicit owner linking. */
export async function ensureAgentAccount(
  db: Executor,
  userId: string,
  connectionId: string,
  platform: AgentPlatform = "unknown",
  now = new Date(),
): Promise<AgentAccount> {
  await lockConnection(db, userId, connectionId);
  const existing = await findAgentAccount(db, userId, connectionId);
  if (existing) {
    if (
      existing.platform === "unknown" &&
      platform !== "unknown" &&
      existing.identitySource === "connection"
    ) {
      const [updated] = await db
        .update(agentAccounts)
        .set({ platform, updatedAt: now })
        .where(
          and(
            eq(agentAccounts.id, existing.id),
            eq(agentAccounts.userId, userId),
            eq(agentAccounts.platform, "unknown"),
            eq(agentAccounts.identitySource, "connection"),
          ),
        )
        .returning();
      if (updated) return serialize(updated);
      return (await findAgentAccount(db, userId, connectionId)) ?? existing;
    }
    return existing;
  }
  const id = randomUUID();
  const [account] = await db
    .insert(agentAccounts)
    .values({
      id,
      userId,
      platform,
      displayName: generatedAgentName(id),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!account) throw new AppError("internal_error", "Could not register the agent account.");
  await db.insert(agentAccountConnections).values({
    userId,
    authorizationConnectionId: connectionId,
    agentAccountId: id,
    createdAt: now,
    updatedAt: now,
  });
  return serialize(account);
}
export function createAgentAccountService({
  db,
  now = () => new Date(),
}: {
  db: Database;
  now?: () => Date;
}) {
  async function audit(
    tx: Executor,
    p: Principal,
    action: string,
    id: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
  ) {
    await tx.insert(auditEvents).values({
      userId: p.userId,
      actorId: p.actorId,
      actorType: p.actorType,
      requestId: randomUUID(),
      action,
      entityType: "agent_account",
      entityId: id,
      before,
      after,
    });
  }
  return {
    async current(p: Principal) {
      if (p.actorType !== "agent" || !p.authorizationConnectionId)
        throw new AppError("forbidden", "Use an authenticated agent connection.");
      return findAgentAccount(db, p.userId, p.authorizationConnectionId);
    },
    async register(p: Principal, raw: unknown) {
      if (p.actorType !== "agent" || !p.authorizationConnectionId)
        throw new AppError("forbidden", "Use an authenticated agent connection.");
      const input = agentAccountRegistrationSchema.parse(raw);
      const connectionId = p.authorizationConnectionId;
      return db.transaction(async (tx) => {
        await lockConnection(tx, p.userId, connectionId);
        const existing = await findAgentAccount(tx, p.userId, connectionId);
        const account = await ensureAgentAccount(tx, p.userId, connectionId, input.platform, now());
        if (!existing)
          await audit(tx, p, "agent_account.registered", account.id, null, { connectionId });
        return account;
      });
    },
    async list(p: Principal): Promise<AgentAccountDirectory> {
      human(p);
      const [accounts, tokens, bindings] = await Promise.all([
        db.select().from(agentAccounts).where(eq(agentAccounts.userId, p.userId)),
        db
          .select({
            token: accessTokens,
            active: sql<boolean>`coalesce(${activeHostConnectionGrant(now())}, false)`,
          })
          .from(accessTokens)
          .where(eq(accessTokens.userId, p.userId)),
        db
          .select()
          .from(agentAccountConnections)
          .where(eq(agentAccountConnections.userId, p.userId)),
      ]);
      const connections = new Map<string, AgentAccountDirectory["connections"][number]>();
      const accountByConnection = new Map(
        bindings.map((b) => [b.authorizationConnectionId, b.agentAccountId]),
      );
      for (const { token, active } of tokens) {
        const previous = connections.get(token.authorizationConnectionId);
        const used = token.lastUsedAt?.toISOString() ?? null;
        connections.set(token.authorizationConnectionId, {
          id: token.authorizationConnectionId,
          label: previous?.active ? previous.label : token.name,
          agentAccountId: accountByConnection.get(token.authorizationConnectionId) ?? null,
          active: active || previous?.active || false,
          scopes: [...new Set([...(previous?.scopes ?? []), ...(active ? token.scopes : [])])],
          lastUsedAt:
            previous?.lastUsedAt && (!used || previous.lastUsedAt > used)
              ? previous.lastUsedAt
              : used,
        });
      }
      return { accounts: accounts.map(serialize), connections: [...connections.values()] };
    },
    async update(p: Principal, id: string, raw: unknown) {
      human(p);
      const input = agentAccountUpdateSchema.parse(raw);
      return db.transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(agentAccounts)
          .where(and(eq(agentAccounts.userId, p.userId), eq(agentAccounts.id, id)))
          .for("update");
        if (!before) throw new AppError("not_found", "Agent account not found.");
        const [after] = await tx
          .update(agentAccounts)
          .set({
            ...input,
            ...(input.platform !== undefined ? { identitySource: "user_confirmed" as const } : {}),
            updatedAt: now(),
          })
          .where(and(eq(agentAccounts.userId, p.userId), eq(agentAccounts.id, id)))
          .returning();
        if (!after) throw new AppError("not_found", "Agent account not found.");
        await audit(
          tx,
          p,
          "agent_account.updated",
          id,
          {
            displayName: before.displayName,
            accountLabel: before.accountLabel,
            platform: before.platform,
          },
          input,
        );
        return serialize(after);
      });
    },
    async link(p: Principal, connectionId: string, raw: unknown) {
      human(p);
      const input = agentAccountLinkSchema.parse(raw);
      return db.transaction(async (tx) => {
        await lockConnection(tx, p.userId, connectionId);
        const [token] = await tx
          .select({ id: accessTokens.id })
          .from(accessTokens)
          .where(
            and(
              eq(accessTokens.userId, p.userId),
              eq(accessTokens.authorizationConnectionId, connectionId),
            ),
          )
          .limit(1);
        if (!token) throw new AppError("not_found", "Agent connection not found.");
        const before = await findAgentAccount(tx, p.userId, connectionId);
        let account: AgentAccount;
        if (input.agentAccountId) {
          const [target] = await tx
            .select()
            .from(agentAccounts)
            .where(
              and(eq(agentAccounts.userId, p.userId), eq(agentAccounts.id, input.agentAccountId)),
            )
            .for("update");
          if (!target) throw new AppError("not_found", "Agent account not found.");
          if (
            before &&
            before.platform !== "unknown" &&
            target.platform !== "unknown" &&
            before.platform !== target.platform
          )
            throw new AppError("invalid_request", "Choose an account on the same platform.");
          account = serialize(target);
        } else {
          const id = randomUUID();
          const [target] = await tx
            .insert(agentAccounts)
            .values({
              id,
              userId: p.userId,
              platform: input.platform ?? before?.platform ?? "unknown",
              displayName: generatedAgentName(id),
              identitySource: "user_confirmed",
              createdAt: now(),
              updatedAt: now(),
            })
            .returning();
          if (!target) throw new AppError("internal_error", "Could not create the agent account.");
          account = serialize(target);
        }
        await tx
          .insert(agentAccountConnections)
          .values({
            userId: p.userId,
            authorizationConnectionId: connectionId,
            agentAccountId: account.id,
          })
          .onConflictDoUpdate({
            target: [
              agentAccountConnections.userId,
              agentAccountConnections.authorizationConnectionId,
            ],
            set: { agentAccountId: account.id, updatedAt: now() },
          });
        await tx
          .update(agentAccounts)
          .set({ identitySource: "user_confirmed", updatedAt: now() })
          .where(and(eq(agentAccounts.userId, p.userId), eq(agentAccounts.id, account.id)));
        await audit(
          tx,
          p,
          "agent_account.connection_linked",
          account.id,
          { connectionId, agentAccountId: before?.id ?? null },
          { connectionId, agentAccountId: account.id },
        );
        return {
          ...account,
          identitySource: "user_confirmed" as const,
          updatedAt: now().toISOString(),
        };
      });
    },
  };
}
