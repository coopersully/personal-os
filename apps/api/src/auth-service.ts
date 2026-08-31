import {
  accessTokens,
  accountActionTokens,
  calendarAccounts,
  calendars,
  type Database,
  invitations,
  sessions,
  users,
} from "@personal-os/database";
import type {
  AccessScope,
  CreateAccessTokenInput,
  CreateInvitationInput,
  Invitation,
  LoginInput,
  RegisterInput,
  UpdateAccountSetupInput,
  UpdateUserInput,
  User,
} from "@personal-os/domain";
import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { requireDatabaseRecord } from "./database.js";
import { AppError, isUniqueViolation } from "./errors.js";
import {
  generateInvitationCode,
  generateToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from "./security.js";
import { serializeUser } from "./serialization.js";
import type { Principal } from "./types.js";

const allScopes = new Set<AccessScope>([
  "audit:read",
  "automations:read",
  "automations:write",
  "bookmarks:read",
  "calendar:read",
  "calendar:write",
  "mail:read",
  "mail:write",
  "goals:read",
  "goals:write",
  "finances:read",
  "finances:write",
  "finances:maintain",
  "reminders:read",
  "reminders:write",
  "texting:read",
  "texting:write",
  "tasks:read",
  "tasks:write",
]);
const inactiveNewTokenScopes = new Set<AccessScope>(["automations:write"]);

type AccountActionPurpose = "email_verification" | "password_reset";

export type ClientMetadata = {
  ipAddress: string | null;
  userAgent: string | null;
};

export type SessionResult = {
  expiresAt: string;
  token: string;
  user: User;
};

export type SessionSummary = {
  createdAt: string;
  expiresAt: string;
  id: string;
  ipAddress: string | null;
  lastSeenAt: string;
  userAgent: string | null;
};

export type AccessTokenSummary = {
  createdAt: string;
  expiresAt: string | null;
  id: string;
  lastUsedAt: string | null;
  name: string;
  revokedAt: string | null;
  scopes: AccessScope[];
};

export type CreatedAccessToken = AccessTokenSummary & { token: string };

type AuthServiceOptions = {
  db: Database;
  now: () => Date;
  ownerEmails?: readonly string[];
  registrationMode?: "invite" | "open";
  sessionTtlDays: number;
};

export function createAuthService(options: AuthServiceOptions) {
  const { db, now, sessionTtlDays } = options;
  const ownerEmails = new Set(options.ownerEmails ?? []);
  const registrationMode = options.registrationMode ?? "invite";
  const serializeUserWithCapabilities = (user: typeof users.$inferSelect): User => ({
    ...serializeUser(user),
    canManageInvitations: ownerEmails.has(user.email),
  });

  async function createSession(
    userId: string,
    metadata: ClientMetadata,
  ): Promise<{ expiresAt: Date; token: string }> {
    const token = generateToken("sess");
    const expiresAt = new Date(now().getTime() + sessionTtlDays * 86_400_000);
    await db.insert(sessions).values({
      expiresAt,
      ipAddress: metadata.ipAddress,
      tokenHash: hashToken(token),
      userAgent: metadata.userAgent,
      userId,
    });
    return { expiresAt, token };
  }

  async function createAccountActionToken(
    userId: string,
    purpose: AccountActionPurpose,
    prefix: "reset" | "verify",
    ttlMs: number,
  ): Promise<string> {
    const token = generateToken(prefix);
    const currentTime = now();
    await db.transaction(async (transaction) => {
      await transaction
        .delete(accountActionTokens)
        .where(
          and(
            eq(accountActionTokens.userId, userId),
            eq(accountActionTokens.purpose, purpose),
            isNull(accountActionTokens.usedAt),
          ),
        );
      await transaction.insert(accountActionTokens).values({
        expiresAt: new Date(currentTime.getTime() + ttlMs),
        purpose,
        tokenHash: hashToken(token),
        userId,
      });
    });
    return token;
  }

  async function consumeAccountActionToken(
    token: string,
    purpose: AccountActionPurpose,
  ): Promise<string> {
    const currentTime = now();
    return db.transaction(async (transaction) => {
      const [record] = await transaction
        .select()
        .from(accountActionTokens)
        .where(
          and(
            eq(accountActionTokens.tokenHash, hashToken(token)),
            eq(accountActionTokens.purpose, purpose),
            isNull(accountActionTokens.usedAt),
            gt(accountActionTokens.expiresAt, currentTime),
          ),
        )
        .limit(1);
      if (!record) {
        throw new AppError("invalid_request", "This link is invalid or has expired.");
      }
      const [used] = await transaction
        .update(accountActionTokens)
        .set({ usedAt: currentTime })
        .where(and(eq(accountActionTokens.id, record.id), isNull(accountActionTokens.usedAt)))
        .returning({ id: accountActionTokens.id });
      if (!used) {
        throw new AppError("invalid_request", "This link is invalid or has expired.");
      }
      return record.userId;
    });
  }

  function serializeInvitation(record: typeof invitations.$inferSelect): Invitation {
    return {
      createdAt: record.createdAt.toISOString(),
      email: record.email,
      expiresAt: record.expiresAt.toISOString(),
      id: record.id,
      redeemedAt: record.redeemedAt?.toISOString() ?? null,
    };
  }

  return {
    async authenticateAccessToken(token: string, audience?: string): Promise<Principal> {
      const currentTime = now();
      const [record] = await db
        .select()
        .from(accessTokens)
        .where(
          and(
            eq(accessTokens.tokenHash, hashToken(token)),
            audience
              ? or(isNull(accessTokens.audience), eq(accessTokens.audience, audience))
              : isNull(accessTokens.audience),
            isNull(accessTokens.revokedAt),
            or(isNull(accessTokens.expiresAt), gt(accessTokens.expiresAt, currentTime)),
          ),
        )
        .limit(1);
      if (!record) {
        throw new AppError("unauthorized", "The access token is invalid or expired.");
      }
      await db
        .update(accessTokens)
        .set({ lastUsedAt: currentTime })
        .where(eq(accessTokens.id, record.id));
      return {
        actorId: record.id,
        actorType: "agent",
        scopes: new Set(record.scopes),
        userId: record.userId,
      };
    },

    async authenticateSession(token: string): Promise<Principal> {
      const currentTime = now();
      const [record] = await db
        .select({ session: sessions, user: users })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, currentTime)))
        .limit(1);
      if (!record) {
        throw new AppError("unauthorized", "The session is invalid or expired.");
      }
      await db
        .update(sessions)
        .set({ lastSeenAt: currentTime })
        .where(eq(sessions.id, record.session.id));
      return {
        actorId: record.user.id,
        actorType: "user",
        scopes: allScopes,
        userId: record.user.id,
      };
    },

    async createAccessToken(
      userId: string,
      input: CreateAccessTokenInput,
    ): Promise<CreatedAccessToken> {
      if (input.scopes.some((scope) => inactiveNewTokenScopes.has(scope))) {
        throw new AppError(
          "invalid_request",
          "Legacy automation write access is inactive and cannot be added to new tokens.",
        );
      }
      const token = generateToken("pos");
      const record = requireDatabaseRecord(
        (
          await db
            .insert(accessTokens)
            .values({
              expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
              name: input.name,
              scopes: input.scopes,
              tokenHash: hashToken(token),
              userId,
            })
            .returning()
        )[0],
        "The access token could not be created.",
      );
      return { ...serializeAccessToken(record), token };
    },

    async getUser(userId: string): Promise<User> {
      const [record] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!record) {
        throw new AppError("not_found", "The user was not found.");
      }
      return serializeUserWithCapabilities(record);
    },

    async isOwner(userId: string): Promise<boolean> {
      const [user] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return user ? ownerEmails.has(user.email) : false;
    },

    async createInvitation(
      userId: string,
      input: CreateInvitationInput,
    ): Promise<Invitation & { code: string }> {
      const code = generateInvitationCode();
      const record = requireDatabaseRecord(
        (
          await db
            .insert(invitations)
            .values({
              codeHash: hashToken(code),
              createdByUserId: userId,
              email: input.email ?? null,
              expiresAt: new Date(now().getTime() + input.expiresInDays * 86_400_000),
            })
            .returning()
        )[0],
        "The invitation could not be created.",
      );
      return { ...serializeInvitation(record), code };
    },

    async listInvitations(): Promise<Invitation[]> {
      const records = await db.select().from(invitations).orderBy(desc(invitations.createdAt));
      return records.map(serializeInvitation);
    },

    async updateUser(userId: string, input: UpdateUserInput): Promise<User> {
      try {
        const [current] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        if (!current) throw new AppError("not_found", "The user was not found.");
        const nextWorkdayStartMinute = input.workdayStartMinute ?? current.workdayStartMinute;
        const nextWorkdayEndMinute = input.workdayEndMinute ?? current.workdayEndMinute;
        const emailChanged = input.email !== undefined && input.email !== current.email;
        if (nextWorkdayStartMinute >= nextWorkdayEndMinute) {
          throw new AppError("invalid_request", "Workday end must be after the start.");
        }
        const user = requireDatabaseRecord(
          (
            await db
              .update(users)
              .set({
                ...(input.accentColor === undefined ? {} : { accentColor: input.accentColor }),
                ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
                ...(input.email === undefined ? {} : { email: input.email }),
                ...(input.theme === undefined ? {} : { theme: input.theme }),
                ...(emailChanged ? { emailVerifiedAt: null } : {}),
                ...(input.planningTimezone === undefined
                  ? {}
                  : { planningTimezone: input.planningTimezone }),
                ...(input.homeLocation === undefined ? {} : { homeLocation: input.homeLocation }),
                ...(input.workdayEndMinute === undefined
                  ? {}
                  : { workdayEndMinute: input.workdayEndMinute }),
                ...(input.workdayStartMinute === undefined
                  ? {}
                  : { workdayStartMinute: input.workdayStartMinute }),
                updatedAt: now(),
              })
              .where(eq(users.id, userId))
              .returning()
          )[0],
          "The user could not be updated.",
        );
        return serializeUserWithCapabilities(user);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new AppError("conflict", "That email address is already used by another account.");
        }
        throw error;
      }
    },

    async updateAccountSetup(userId: string, input: UpdateAccountSetupInput): Promise<User> {
      const currentTime = now();
      const values =
        input.action === "progress"
          ? {
              setupCompletedAt: null,
              setupCurrentStep: input.currentStep,
              setupDismissedAt: null,
              ...(input.selectedWorkspaces === undefined
                ? {}
                : { setupSelectedWorkspaces: input.selectedWorkspaces }),
              setupStartedAt: sql`coalesce(${users.setupStartedAt}, ${currentTime})`,
              setupStatus: "in_progress" as const,
              updatedAt: currentTime,
            }
          : input.action === "dismiss"
            ? {
                setupDismissedAt: currentTime,
                setupStatus: "dismissed" as const,
                updatedAt: currentTime,
              }
            : {
                setupCompletedAt: currentTime,
                setupCurrentStep: "ready" as const,
                setupDismissedAt: null,
                setupStatus: "complete" as const,
                updatedAt: currentTime,
              };
      const user = requireDatabaseRecord(
        (await db.update(users).set(values).where(eq(users.id, userId)).returning())[0],
        "The setup progress could not be saved.",
      );
      return serializeUserWithCapabilities(user);
    },

    async createEmailVerificationToken(userId: string): Promise<string> {
      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!user) throw new AppError("not_found", "The user was not found.");
      return createAccountActionToken(userId, "email_verification", "verify", 24 * 60 * 60 * 1000);
    },

    async verifyEmail(token: string): Promise<User> {
      const userId = await consumeAccountActionToken(token, "email_verification");
      const user = requireDatabaseRecord(
        (
          await db
            .update(users)
            .set({ emailVerifiedAt: now(), updatedAt: now() })
            .where(eq(users.id, userId))
            .returning()
        )[0],
        "The account could not be verified.",
      );
      return serializeUserWithCapabilities(user);
    },

    async createPasswordResetToken(
      email: string,
    ): Promise<{ email: string; token: string } | null> {
      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      if (!user) return null;
      return {
        email: user.email,
        token: await createAccountActionToken(user.id, "password_reset", "reset", 60 * 60 * 1000),
      };
    },

    async resetPassword(token: string, password: string): Promise<void> {
      const userId = await consumeAccountActionToken(token, "password_reset");
      await db.transaction(async (transaction) => {
        const passwordHash = await hashPassword(password);
        const [user] = await transaction
          .update(users)
          .set({ passwordHash, updatedAt: now() })
          .where(eq(users.id, userId))
          .returning({ id: users.id });
        if (!user) throw new AppError("not_found", "The user was not found.");
        await transaction.delete(sessions).where(eq(sessions.userId, userId));
      });
    },

    async listAccessTokens(userId: string): Promise<AccessTokenSummary[]> {
      const records = await db
        .select()
        .from(accessTokens)
        .where(and(eq(accessTokens.userId, userId), isNull(accessTokens.clientId)))
        .orderBy(desc(accessTokens.createdAt));
      return records.map(serializeAccessToken);
    },

    async listSessions(userId: string): Promise<SessionSummary[]> {
      const records = await db
        .select()
        .from(sessions)
        .where(eq(sessions.userId, userId))
        .orderBy(desc(sessions.createdAt));
      return records.map((record) => ({
        createdAt: record.createdAt.toISOString(),
        expiresAt: record.expiresAt.toISOString(),
        id: record.id,
        ipAddress: record.ipAddress,
        lastSeenAt: record.lastSeenAt.toISOString(),
        userAgent: record.userAgent,
      }));
    },

    async login(input: LoginInput, metadata: ClientMetadata): Promise<SessionResult> {
      const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
      if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
        throw new AppError("unauthorized", "The email or password is incorrect.");
      }
      const session = await createSession(user.id, metadata);
      return {
        expiresAt: session.expiresAt.toISOString(),
        token: session.token,
        user: serializeUserWithCapabilities(user),
      };
    },

    async validateInvitationCode(inviteCode: string): Promise<boolean> {
      if (registrationMode === "open") return true;
      const [invitation] = await db
        .select({ id: invitations.id })
        .from(invitations)
        .where(
          and(
            eq(invitations.codeHash, hashToken(inviteCode)),
            isNull(invitations.redeemedAt),
            gt(invitations.expiresAt, now()),
          ),
        )
        .limit(1);
      return Boolean(invitation);
    },

    async register(input: RegisterInput, metadata: ClientMetadata): Promise<SessionResult> {
      const passwordHash = await hashPassword(input.password);
      let user: typeof users.$inferSelect;
      try {
        user = await db.transaction(async (transaction) => {
          let invitationId: string | null = null;
          // Configured owners bootstrap the first account; every other account must redeem an invite.
          if (registrationMode === "invite" && !ownerEmails.has(input.email)) {
            if (!input.inviteCode) {
              throw new AppError(
                "forbidden",
                "A valid invitation code is required to create an account.",
              );
            }
            const [invitation] = await transaction
              .select()
              .from(invitations)
              .where(
                and(
                  eq(invitations.codeHash, hashToken(input.inviteCode)),
                  isNull(invitations.redeemedAt),
                  gt(invitations.expiresAt, now()),
                  or(isNull(invitations.email), eq(invitations.email, input.email)),
                ),
              )
              .limit(1);
            if (!invitation) {
              throw new AppError(
                "forbidden",
                "This invitation is invalid, expired, or assigned to another email.",
              );
            }
            invitationId = invitation.id;
          }
          const createdUser = requireDatabaseRecord(
            (
              await transaction
                .insert(users)
                .values({
                  displayName: input.displayName,
                  email: input.email,
                  passwordHash,
                  planningTimezone: input.planningTimezone,
                  setupStatus: "not_started",
                })
                .returning()
            )[0],
            "The account could not be created.",
          );
          const account = requireDatabaseRecord(
            (
              await transaction
                .insert(calendarAccounts)
                .values({
                  label: "Personal",
                  provider: "local",
                  providerAccountId: createdUser.id,
                  userId: createdUser.id,
                })
                .returning()
            )[0],
            "The local calendar account could not be created.",
          );
          await transaction.insert(calendars).values({
            accountId: account.id,
            color: "#5B6CFF",
            isPrimary: true,
            isSelected: true,
            isWritable: true,
            name: "Personal",
            provider: "local",
            remoteCalendarId: createdUser.id,
            timezone: createdUser.planningTimezone,
            userId: createdUser.id,
          });
          if (invitationId) {
            const [redeemed] = await transaction
              .update(invitations)
              .set({ redeemedAt: now(), redeemedByUserId: createdUser.id })
              .where(and(eq(invitations.id, invitationId), isNull(invitations.redeemedAt)))
              .returning({ id: invitations.id });
            if (!redeemed) {
              throw new AppError("forbidden", "This invitation has already been redeemed.");
            }
          }
          return createdUser;
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new AppError("conflict", "An account with this email already exists.");
        }
        throw error;
      }
      const session = await createSession(user.id, metadata);
      return {
        expiresAt: session.expiresAt.toISOString(),
        token: session.token,
        user: serializeUserWithCapabilities(user),
      };
    },

    async revokeAccessToken(userId: string, tokenId: string): Promise<void> {
      const [record] = await db
        .update(accessTokens)
        .set({ revokedAt: now() })
        .where(
          and(
            eq(accessTokens.id, tokenId),
            eq(accessTokens.userId, userId),
            isNull(accessTokens.revokedAt),
          ),
        )
        .returning({ id: accessTokens.id });
      if (!record) {
        throw new AppError("not_found", "The access token was not found.");
      }
    },

    async revokeSession(userId: string, sessionId: string): Promise<void> {
      const [record] = await db
        .delete(sessions)
        .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
        .returning({ id: sessions.id });
      if (!record) {
        throw new AppError("not_found", "The session was not found.");
      }
    },

    async revokeSessionToken(token: string): Promise<void> {
      await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
    },
  };
}

function serializeAccessToken(record: typeof accessTokens.$inferSelect): AccessTokenSummary {
  return {
    createdAt: record.createdAt.toISOString(),
    expiresAt: record.expiresAt?.toISOString() ?? null,
    id: record.id,
    lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
    name: record.name,
    revokedAt: record.revokedAt?.toISOString() ?? null,
    scopes: record.scopes,
  };
}
