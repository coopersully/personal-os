import type { XCredentials } from "./types.js";
import { createXConnector } from "./x.js";

const now = new Date("2026-07-20T12:00:00.000Z");
const credentials: XCredentials = {
  accessToken: "access",
  expiresAt: "2026-07-20T14:00:00.000Z",
  refreshToken: "refresh",
  scope: "bookmark.read",
  tokenType: "Bearer",
};

function response(value: unknown, status = 200) {
  return Response.json(value, { status });
}

function queued(...responses: Response[]) {
  return vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
    const next = responses.shift();
    if (!next) throw new Error("No queued response");
    return next;
  });
}

function connector(fetch: typeof globalThis.fetch, configured = true) {
  return createXConnector({
    clientId: configured ? "x-client" : "",
    clientSecret: configured ? "x-secret" : "",
    fetch,
    now: () => now,
    redirectUri: "https://api.example.com/v1/x-bookmarks/callback",
  });
}

describe("X Bookmarks connector", () => {
  it("uses OAuth PKCE and exchanges a code", async () => {
    const fetch = queued(
      response({ access_token: "new", expires_in: 3600, refresh_token: "offline" }),
    );
    const x = connector(fetch);
    const url = new URL(x.authorizationUrl("state", "verifier"));
    expect(url.origin).toBe("https://x.com");
    expect(url.searchParams.get("state")).toBe("state");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toContain("bookmark.read");
    await expect(x.exchangeCode("code", "verifier")).resolves.toMatchObject({
      accessToken: "new",
      expiresAt: "2026-07-20T13:00:00.000Z",
      refreshToken: "offline",
    });
    expect(String(fetch.mock.calls[0]?.[1]?.body)).toContain("code_verifier=verifier");
    expect(() => connector(fetch, false).authorizationUrl("state", "verifier")).toThrow(
      "not configured",
    );
  });

  it("refreshes expired credentials and reads paginated folders and posts", async () => {
    const fetch = queued(
      response({ access_token: "fresh", expires_in: 7200, refresh_token: "fresh-refresh" }),
      response({ data: [{ id: "folder-1", name: "Calendar" }], meta: { next_token: "next" } }),
      response({ data: [{ id: "folder-2", name: "Later" }] }),
      response({
        data: [
          {
            id: "post-1",
            text: "See this",
            author_id: "author-1",
            created_at: "2026-07-19T11:00:00.000Z",
          },
        ],
        includes: { users: [{ id: "author-1", name: "Ada", username: "ada" }] },
        meta: { next_token: "p2" },
      }),
      response({ data: [{ id: "post-2", text: "No author" }] }),
    );
    const x = connector(fetch);
    const expired = { ...credentials, expiresAt: "2026-07-20T11:00:00.000Z" };
    const folders = await x.listBookmarkFolders(expired, "user 1");
    expect(folders.value).toEqual([
      { id: "folder-1", name: "Calendar" },
      { id: "folder-2", name: "Later" },
    ]);
    expect(String(fetch.mock.calls[2]?.[0])).toContain("users/user%201/bookmarks/folders");
    expect(String(fetch.mock.calls[2]?.[0])).toContain("pagination_token=next");
    const bookmarks = await x.listFolderBookmarks(folders.credentials, "user 1", "folder 1");
    expect(bookmarks.value).toMatchObject([
      { remotePostId: "post-1", authorUsername: "ada", url: "https://x.com/ada/status/post-1" },
      { remotePostId: "post-2", authorUsername: null, url: "https://x.com/i/status/post-2" },
    ]);
    expect(String(fetch.mock.calls[3]?.[0])).toContain("folder%201");
    expect(String(fetch.mock.calls[4]?.[0])).toContain("pagination_token=p2");
  });

  it("reads the authenticated profile and reports provider failures", async () => {
    const fetch = queued(
      response({ data: { id: "user-1", name: "Example User", username: "example_user" } }),
      response({ title: "nope" }, 403),
    );
    const x = connector(fetch);
    await expect(x.getProfile(credentials)).resolves.toMatchObject({
      value: { id: "user-1", name: "Example User", username: "example_user" },
    });
    await expect(x.listBookmarkFolders(credentials, "user-1")).rejects.toMatchObject({
      name: "ConnectorError",
      status: 403,
    });
  });

  it("handles missing optional token and profile fields and requires a refresh token", async () => {
    const fetch = queued(
      response({ access_token: "new", expires_in: 3600 }),
      response({ data: { id: "user-1", username: "example_user" } }),
    );
    const x = connector(fetch);
    await expect(x.exchangeCode("code", "verifier")).resolves.toMatchObject({ refreshToken: "" });
    await expect(x.getProfile(credentials)).resolves.toMatchObject({
      value: { id: "user-1", name: null, username: "example_user" },
    });
    await expect(
      x.listBookmarkFolders(
        {
          ...credentials,
          expiresAt: "2026-07-20T11:00:00.000Z",
          refreshToken: "",
        },
        "user-1",
      ),
    ).rejects.toMatchObject({ name: "ConnectorError", status: 401 });
  });
});
