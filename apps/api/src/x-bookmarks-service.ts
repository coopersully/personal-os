import { randomUUID } from "node:crypto";
import {
  ConnectorError,
  type XBookmarkFolder,
  type XConnector,
  type XCredentials,
} from "@personal-os/connectors";
import {
  auditEvents,
  type Database,
  oauthStates,
  xBookmarkAccounts,
  xBookmarkFolders,
  xBookmarks,
} from "@personal-os/database";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { auditValues } from "./audit.js";
import { createConnectorAuthorizationService } from "./connector-authorization-service.js";
import { requireDatabaseRecord } from "./database.js";
import { AppError } from "./errors.js";
import { decryptJson, encryptJson } from "./security.js";

type Account = typeof xBookmarkAccounts.$inferSelect;

type Options = {
  db: Database;
  encryptionKey: string;
  now: () => Date;
  x: XConnector;
  xRedirectUri?: string;
};

function publicAccount(account: Account) {
  return {
    displayName: account.displayName,
    id: account.id,
    lastSyncedAt: account.lastSyncedAt?.toISOString() ?? null,
    selectedFolderId: account.selectedFolderId,
    selectedFolderName: account.selectedFolderName,
    syncError: account.syncError,
    syncStatus: account.syncStatus,
    username: account.username,
  };
}

export function createXBookmarksService({
  db,
  encryptionKey,
  now,
  x,
  xRedirectUri = "https://api.ilo.invalid/v1/x-bookmarks/callback",
}: Options) {
  const authorization = createConnectorAuthorizationService({ db, encryptionKey, now });
  function credentials(account: Account): XCredentials {
    return decryptJson<XCredentials>(account.encryptedCredentials, encryptionKey);
  }

  async function accountFor(userId: string): Promise<Account> {
    const [account] = await db
      .select()
      .from(xBookmarkAccounts)
      .where(eq(xBookmarkAccounts.userId, userId))
      .orderBy(asc(xBookmarkAccounts.createdAt))
      .limit(1);
    if (!account) throw new AppError("not_found", "Connect X Bookmarks first.");
    return account;
  }

  async function saveCredentials(accountId: string, value: XCredentials): Promise<void> {
    await db
      .update(xBookmarkAccounts)
      .set({ encryptedCredentials: encryptJson(value, encryptionKey), updatedAt: now() })
      .where(eq(xBookmarkAccounts.id, accountId));
  }

  async function saveFolders(account: Account, folders: XBookmarkFolder[]) {
    for (const folder of folders) {
      await db
        .insert(xBookmarkFolders)
        .values({ accountId: account.id, name: folder.name, remoteFolderId: folder.id })
        .onConflictDoUpdate({
          set: { name: folder.name, updatedAt: now() },
          target: [xBookmarkFolders.accountId, xBookmarkFolders.remoteFolderId],
        });
    }
    return db
      .select()
      .from(xBookmarkFolders)
      .where(eq(xBookmarkFolders.accountId, account.id))
      .orderBy(asc(xBookmarkFolders.name));
  }

  async function folders(userId: string) {
    const account = await accountFor(userId);
    await db
      .update(xBookmarkAccounts)
      .set({ syncError: null, syncStatus: "syncing", updatedAt: now() })
      .where(eq(xBookmarkAccounts.id, account.id));
    try {
      const result = await x.listBookmarkFolders(credentials(account), account.providerAccountId);
      await saveCredentials(account.id, result.credentials);
      const saved = await saveFolders(account, result.value);
      await db
        .update(xBookmarkAccounts)
        .set({ syncError: null, syncStatus: "idle", updatedAt: now() })
        .where(eq(xBookmarkAccounts.id, account.id));
      return saved;
    } catch (error) {
      await db
        .update(xBookmarkAccounts)
        .set({
          syncError: safeXSyncError(error),
          syncStatus: "error",
          updatedAt: now(),
        })
        .where(eq(xBookmarkAccounts.id, account.id));
      throw connectorError(error);
    }
  }

  async function sync(userId: string): Promise<{ changed: number }> {
    const account = await accountFor(userId);
    if (!account.selectedFolderId)
      throw new AppError("invalid_request", "Choose an X bookmark folder first.");
    await db
      .update(xBookmarkAccounts)
      .set({ syncError: null, syncStatus: "syncing", updatedAt: now() })
      .where(eq(xBookmarkAccounts.id, account.id));
    try {
      const result = await x.listFolderBookmarks(
        credentials(account),
        account.providerAccountId,
        account.selectedFolderId,
      );
      const [folder] = await db
        .select()
        .from(xBookmarkFolders)
        .where(
          and(
            eq(xBookmarkFolders.accountId, account.id),
            eq(xBookmarkFolders.remoteFolderId, account.selectedFolderId),
          ),
        )
        .limit(1);
      const syncedAt = now();
      let changed = 0;
      for (const bookmark of result.value) {
        const [existing] = await db
          .select()
          .from(xBookmarks)
          .where(
            and(
              eq(xBookmarks.accountId, account.id),
              eq(xBookmarks.remotePostId, bookmark.remotePostId),
            ),
          )
          .limit(1);
        const values = {
          authorId: bookmark.authorId,
          authorName: bookmark.authorName,
          authorUsername: bookmark.authorUsername,
          deletedAt: null,
          folderId: folder?.id ?? null,
          postUrl: bookmark.url,
          postedAt: bookmark.postedAt,
          raw: bookmark.raw,
          syncedAt,
          text: bookmark.text,
          updatedAt: syncedAt,
        };
        const [after] = existing
          ? await db
              .update(xBookmarks)
              .set(values)
              .where(eq(xBookmarks.id, existing.id))
              .returning()
          : await db
              .insert(xBookmarks)
              .values({
                ...values,
                accountId: account.id,
                remotePostId: bookmark.remotePostId,
                userId,
              })
              .returning();
        if (
          after &&
          (!existing ||
            existing.deletedAt ||
            existing.text !== after.text ||
            existing.folderId !== after.folderId)
        )
          changed += 1;
      }
      await db
        .update(xBookmarkAccounts)
        .set({
          encryptedCredentials: encryptJson(result.credentials, encryptionKey),
          lastSyncedAt: syncedAt,
          syncError: null,
          syncStatus: "idle",
          updatedAt: syncedAt,
        })
        .where(eq(xBookmarkAccounts.id, account.id));
      await db.insert(auditEvents).values(
        auditValues({
          action: "x_bookmarks.synced",
          after: { bookmarks: result.value.length, folderId: account.selectedFolderId },
          before: null,
          entityId: account.id,
          entityType: "x_bookmark_account",
          principal: { actorId: account.id, actorType: "connector", userId },
          requestId: `sync:${randomUUID()}`,
        }),
      );
      return { changed };
    } catch (error) {
      await db
        .update(xBookmarkAccounts)
        .set({ syncError: safeXSyncError(error), syncStatus: "error", updatedAt: now() })
        .where(eq(xBookmarkAccounts.id, account.id));
      throw connectorError(error);
    }
  }

  async function handleAuthorizationCallback(input: {
    code?: string;
    error?: string;
    requestId: string;
    state: string;
  }): Promise<{
    attemptId: string | null;
    returnPath: "/settings?section=connections";
    status: "pending" | "connected" | "cancelled" | "expired" | "failed";
  }> {
    const consumed = await authorization.consume("x", input.state, input.requestId);
    if (consumed.kind === "invalid") {
      return {
        attemptId: null,
        returnPath: "/settings?section=connections",
        status: "failed",
      };
    }
    const result = (status: "pending" | "connected" | "cancelled" | "expired" | "failed") => ({
      attemptId: consumed.attempt.id,
      returnPath: "/settings?section=connections" as const,
      status,
    });
    if (consumed.kind === "expired") return result("expired");
    if (consumed.kind === "processing") return result("pending");
    if (consumed.kind === "closed") {
      return result(
        consumed.attempt.status === "connected" ||
          consumed.attempt.status === "cancelled" ||
          consumed.attempt.status === "expired"
          ? consumed.attempt.status
          : consumed.attempt.status === "processing" || consumed.attempt.status === "pending"
            ? "pending"
            : "failed",
      );
    }
    const close = async (status: "cancelled" | "failed", outcomeCode: string) => {
      await authorization.close({
        accountId: null,
        attemptId: consumed.attempt.id,
        outcomeCode,
        status,
      });
      return result(status);
    };
    if (input.error) {
      return input.error === "access_denied"
        ? close("cancelled", "authorization_cancelled")
        : close("failed", "provider_authorization_failed");
    }
    if (!input.code) return close("failed", "authorization_code_missing");
    try {
      let value = await x.exchangeCode(
        input.code,
        consumed.codeVerifier,
        consumed.attempt.redirectUri ?? xRedirectUri,
      );
      const profile = await x.getProfile(value);
      value = profile.credentials;
      await db.transaction(async (transaction) => {
        const account = requireDatabaseRecord(
          (
            await transaction
              .insert(xBookmarkAccounts)
              .values({
                displayName: profile.value.name,
                encryptedCredentials: encryptJson(value, encryptionKey),
                providerAccountId: profile.value.id,
                username: profile.value.username,
                userId: consumed.attempt.userId,
              })
              .onConflictDoUpdate({
                set: {
                  displayName: profile.value.name,
                  encryptedCredentials: encryptJson(value, encryptionKey),
                  syncError: null,
                  syncStatus: "idle",
                  updatedAt: now(),
                },
                target: [xBookmarkAccounts.userId, xBookmarkAccounts.providerAccountId],
              })
              .returning()
          )[0],
          "The X account could not be saved.",
        );
        await authorization.close(
          {
            accountId: account.id,
            attemptId: consumed.attempt.id,
            outcomeCode: "connected",
            status: "connected",
          },
          transaction,
        );
      });
      return result("connected");
    } catch (error) {
      const outcomeCode =
        error instanceof ConnectorError &&
        (error.category === "temporary" || error.category === "transport")
          ? "provider_temporarily_unavailable"
          : "authorization_failed";
      try {
        return await close("failed", outcomeCode);
      } catch {
        return result("failed");
      }
    }
  }

  return {
    async completeAuthorization(state: string, code: string) {
      const callback = await handleAuthorizationCallback({
        code,
        requestId: randomUUID(),
        state,
      });
      if (callback.status !== "connected" || !callback.attemptId) {
        throw new AppError("invalid_request", "The X authorization could not be completed.");
      }
      const [attempt] = await db
        .select()
        .from(oauthStates)
        .where(eq(oauthStates.id, callback.attemptId))
        .limit(1);
      if (!attempt?.connectedAccountId) {
        throw new AppError("invalid_request", "The X authorization could not be completed.");
      }
      return publicAccount(await accountFor(attempt.userId));
    },
    handleAuthorizationCallback,
    async disconnect(userId: string) {
      const account = await accountFor(userId);
      await db.delete(xBookmarkAccounts).where(eq(xBookmarkAccounts.id, account.id));
    },
    async getAccount(userId: string) {
      const [account] = await db
        .select()
        .from(xBookmarkAccounts)
        .where(eq(xBookmarkAccounts.userId, userId))
        .orderBy(asc(xBookmarkAccounts.createdAt))
        .limit(1);
      return account ? publicAccount(account) : null;
    },
    folders,
    async list(userId: string, limit: number) {
      const account = await accountFor(userId);
      const records = await db
        .select()
        .from(xBookmarks)
        .where(and(eq(xBookmarks.accountId, account.id), isNull(xBookmarks.deletedAt)))
        .orderBy(desc(xBookmarks.postedAt), desc(xBookmarks.syncedAt))
        .limit(limit);
      return records.map((bookmark) => ({
        authorName: bookmark.authorName,
        authorUsername: bookmark.authorUsername,
        id: bookmark.id,
        postUrl: bookmark.postUrl,
        postedAt: bookmark.postedAt?.toISOString() ?? null,
        remotePostId: bookmark.remotePostId,
        source: {
          accountId: account.id,
          provider: "x" as const,
          remoteId: bookmark.remotePostId,
          revision: null,
          sourceType: "bookmark" as const,
        },
        syncedAt: bookmark.syncedAt.toISOString(),
        text: bookmark.text,
      }));
    },
    async selectFolder(userId: string, folderId: string) {
      const account = await accountFor(userId);
      const available = await folders(userId);
      const folder = available.find((item) => item.remoteFolderId === folderId);
      if (!folder)
        throw new AppError("invalid_request", "The selected X bookmark folder was not found.");
      await db
        .update(xBookmarkAccounts)
        .set({
          selectedFolderId: folder.remoteFolderId,
          selectedFolderName: folder.name,
          syncError: null,
          updatedAt: now(),
        })
        .where(eq(xBookmarkAccounts.id, account.id));
      return sync(userId);
    },
    async startAuthorization(userId: string) {
      const attempt = await authorization.create({
        provider: "x",
        redirectUri: xRedirectUri,
        requestedServices: null,
        returnPath: "/settings?section=connections",
        targetAccountId: null,
        userId,
      });
      try {
        return x.authorizationUrl(attempt.state, attempt.codeVerifier);
      } catch (error) {
        throw connectorError(error);
      }
    },
    sync,
  };
}

function connectorError(error: unknown): Error {
  if (error instanceof ConnectorError) {
    return new AppError(
      error.status === 401 ? "unauthorized" : "service_unavailable",
      error.message,
    );
  }
  return error instanceof Error
    ? error
    : new AppError("internal_error", "Unknown X connector error.");
}

function safeXSyncError(error: unknown): string {
  if (error instanceof ConnectorError && error.disposition === "reconnect") {
    return "X authorization is no longer valid. Reconnect to resume syncing.";
  }
  return "X is temporarily unavailable. ilo will retry automatically.";
}
