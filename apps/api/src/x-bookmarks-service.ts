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
import { and, asc, desc, eq, gt, isNull } from "drizzle-orm";
import { auditValues } from "./audit.js";
import { requireDatabaseRecord } from "./database.js";
import { AppError } from "./errors.js";
import { decryptJson, encryptJson, generateToken, hashToken } from "./security.js";

const OAUTH_STATE_TTL_MS = 30 * 60_000;
type Account = typeof xBookmarkAccounts.$inferSelect;

type Options = {
  db: Database;
  encryptionKey: string;
  now: () => Date;
  x: XConnector;
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

export function createXBookmarksService({ db, encryptionKey, now, x }: Options) {
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
          syncError: error instanceof Error ? error.message : "Unknown X folder discovery error",
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
      const message = error instanceof Error ? error.message : "Unknown X sync error";
      await db
        .update(xBookmarkAccounts)
        .set({ syncError: message, syncStatus: "error", updatedAt: now() })
        .where(eq(xBookmarkAccounts.id, account.id));
      throw connectorError(error);
    }
  }

  return {
    async completeAuthorization(state: string, code: string) {
      const [oauth] = await db
        .select()
        .from(oauthStates)
        .where(
          and(
            eq(oauthStates.tokenHash, hashToken(state)),
            eq(oauthStates.provider, "x"),
            isNull(oauthStates.consumedAt),
            gt(oauthStates.expiresAt, now()),
          ),
        )
        .limit(1);
      if (!oauth?.encryptedVerifier)
        throw new AppError("invalid_request", "The X authorization state is invalid or expired.");
      await db.update(oauthStates).set({ consumedAt: now() }).where(eq(oauthStates.id, oauth.id));
      try {
        let value = await x.exchangeCode(
          code,
          decryptJson<{ codeVerifier: string }>(oauth.encryptedVerifier, encryptionKey)
            .codeVerifier,
        );
        const profile = await x.getProfile(value);
        value = profile.credentials;
        const account = requireDatabaseRecord(
          (
            await db
              .insert(xBookmarkAccounts)
              .values({
                displayName: profile.value.name,
                encryptedCredentials: encryptJson(value, encryptionKey),
                providerAccountId: profile.value.id,
                username: profile.value.username,
                userId: oauth.userId,
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
        return publicAccount(account);
      } catch (error) {
        throw connectorError(error);
      }
    },
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
      const state = generateToken("oauth");
      const codeVerifier = generateToken("pkce");
      try {
        const url = x.authorizationUrl(state, codeVerifier);
        await db.insert(oauthStates).values({
          encryptedVerifier: encryptJson({ codeVerifier }, encryptionKey),
          expiresAt: new Date(now().getTime() + OAUTH_STATE_TTL_MS),
          provider: "x",
          tokenHash: hashToken(state),
          userId,
        });
        return url;
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
