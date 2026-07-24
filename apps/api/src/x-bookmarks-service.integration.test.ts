import { resolve } from "node:path";
import { ConnectorError, type XConnector, type XCredentials } from "@personal-os/connectors";
import { createDatabaseClient, migrateDatabase, users } from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createXBookmarksService } from "./x-bookmarks-service.js";

const timestamp = new Date("2026-07-20T12:00:00.000Z");
const encryptionKey = Buffer.alloc(32, 8).toString("base64");
const credentials: XCredentials = {
  accessToken: "access",
  expiresAt: "2026-07-20T13:00:00.000Z",
  refreshToken: "refresh",
  scope: "bookmark.read",
  tokenType: "Bearer",
};

function mockX(): XConnector {
  return {
    authorizationUrl: vi.fn((state) => `https://x.example.com/auth?state=${state}`),
    exchangeCode: vi.fn(async () => credentials),
    getProfile: vi.fn(async (value) => ({
      credentials: value,
      value: { id: "x-user", name: "Example User", username: "example_user" },
    })),
    listBookmarkFolders: vi.fn(async (value) => ({
      credentials: value,
      value: [
        { id: "folder-calendar", name: "Calendar" },
        { id: "folder-later", name: "Later" },
      ],
    })),
    listFolderBookmarks: vi.fn(async (value, _userId, folderId) => ({
      credentials: { ...value, accessToken: "rotated" },
      value: [
        {
          authorId: "author-1",
          authorName: "Ada Lovelace",
          authorUsername: "ada",
          postedAt: new Date("2026-07-19T11:00:00.000Z"),
          raw: { id: "post-1" },
          remotePostId: "post-1",
          text: `${folderId}: See this event`,
          url: "https://x.com/ada/status/post-1",
        },
      ],
    })),
  };
}

describe.sequential("X Bookmarks service", () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabaseClient>;
  let userId: string;
  let x: XConnector;
  let service: ReturnType<typeof createXBookmarksService>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine")
      .withDatabase("personal_os")
      .withUsername("personal_os")
      .withPassword("personal_os")
      .start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
    const [user] = await database.db
      .insert(users)
      .values({
        displayName: "X Test",
        email: "x@example.com",
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!user) throw new Error("Fixture user was not created.");
    userId = user.id;
    x = mockX();
    service = createXBookmarksService({ db: database.db, encryptionKey, now: () => timestamp, x });
  }, 120_000);

  afterAll(async () => {
    await database.close();
    await container.stop();
  });

  it("authorizes once, persists folders, syncs the chosen folder, and exposes attributed bookmarks", async () => {
    const url = await service.startAuthorization(userId);
    const state = String(new URL(url).searchParams.get("state"));
    expect(await service.completeAuthorization(state, "code")).toMatchObject({
      username: "example_user",
      selectedFolderId: null,
    });
    await expect(service.completeAuthorization(state, "code")).rejects.toThrow(
      "invalid or expired",
    );
    expect(await service.folders(userId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Calendar", remoteFolderId: "folder-calendar" }),
      ]),
    );
    await expect(service.selectFolder(userId, "missing")).rejects.toThrow("not found");
    await expect(service.selectFolder(userId, "folder-calendar")).resolves.toEqual({ changed: 1 });
    await expect(service.sync(userId)).resolves.toEqual({ changed: 0 });
    await expect(service.list(userId, 10)).resolves.toMatchObject([
      {
        authorUsername: "ada",
        postUrl: "https://x.com/ada/status/post-1",
        source: { provider: "x", remoteId: "post-1", sourceType: "bookmark" },
        text: "folder-calendar: See this event",
      },
    ]);
    expect(await service.getAccount(userId)).toMatchObject({
      selectedFolderName: "Calendar",
      syncStatus: "idle",
    });
  });

  it("requires a selected folder and can disconnect", async () => {
    await service.disconnect(userId);
    const url = await service.startAuthorization(userId);
    const state = String(new URL(url).searchParams.get("state"));
    await service.completeAuthorization(state, "code");
    await expect(service.sync(userId)).rejects.toThrow("Choose an X bookmark folder first");
    vi.mocked(x.listBookmarkFolders).mockRejectedValueOnce(
      new ConnectorError("X is unavailable", 503),
    );
    await expect(service.folders(userId)).rejects.toThrow("X is unavailable");
    await service.selectFolder(userId, "folder-calendar");
    vi.mocked(x.listFolderBookmarks).mockRejectedValueOnce(
      new ConnectorError("X needs reauthorization", 401),
    );
    await expect(service.sync(userId)).rejects.toThrow("X needs reauthorization");
    await service.disconnect(userId);
    await expect(service.list(userId, 10)).rejects.toThrow("Connect X Bookmarks first");
    await expect(service.disconnect(userId)).rejects.toThrow("Connect X Bookmarks first");
  });
});
