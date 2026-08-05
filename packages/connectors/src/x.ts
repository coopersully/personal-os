import { createHash } from "node:crypto";
import { z } from "zod";
import { ConnectorError, connectorHttpError } from "./failures.js";
import { providerFetch } from "./http.js";
import type { XBookmark, XBookmarkFolder, XConnector, XCredentials } from "./types.js";

const tokenSchema = z.object({
  access_token: z.string(),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().optional(),
  scope: z.string().default(""),
  token_type: z.string().default("Bearer"),
});
const profileSchema = z.object({
  data: z.object({ id: z.string(), name: z.string().optional(), username: z.string() }),
});
const folderSchema = z.object({ id: z.string(), name: z.string() });
const foldersSchema = z.object({
  data: z.array(folderSchema).default([]),
  meta: z.object({ next_token: z.string().optional() }).optional(),
});
const postSchema = z.object({
  author_id: z.string().optional(),
  created_at: z.string().datetime().optional(),
  id: z.string(),
  text: z.string(),
});
const userSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  username: z.string().optional(),
});
const postsSchema = z.object({
  data: z.array(postSchema).default([]),
  includes: z.object({ users: z.array(userSchema).default([]) }).optional(),
  meta: z.object({ next_token: z.string().optional() }).optional(),
});

type XConnectorOptions = {
  clientId: string;
  clientSecret: string;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  redirectUri: string;
};

function base64Url(value: Buffer): string {
  return value.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function createXConnector(options: XConnectorOptions): XConnector {
  const request = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());

  function requireConfiguration(): void {
    if (!options.clientId || !options.redirectUri) {
      throw new ConnectorError({
        category: "configuration",
        code: "x_not_configured",
        disposition: "operator",
        message: "X Bookmarks is not configured.",
        status: 503,
      });
    }
  }

  async function parseResponse(response: Response): Promise<unknown> {
    if (!response.ok) {
      throw await connectorHttpError(response, "x");
    }
    return response.json();
  }

  async function exchange(parameters: URLSearchParams): Promise<XCredentials> {
    requireConfiguration();
    const headers = new Headers({ "content-type": "application/x-www-form-urlencoded" });
    if (options.clientSecret) {
      headers.set(
        "authorization",
        `Basic ${Buffer.from(`${options.clientId}:${options.clientSecret}`).toString("base64")}`,
      );
    }
    const response = await providerFetch(request, "https://api.x.com/2/oauth2/token", {
      body: parameters,
      headers,
      method: "POST",
    });
    const token = tokenSchema.parse(await parseResponse(response));
    return {
      accessToken: token.access_token,
      expiresAt: new Date(now().getTime() + token.expires_in * 1_000).toISOString(),
      refreshToken: token.refresh_token ?? "",
      scope: token.scope,
      tokenType: token.token_type,
    };
  }

  async function validCredentials(credentials: XCredentials): Promise<XCredentials> {
    if (new Date(credentials.expiresAt).getTime() > now().getTime() + 60_000) return credentials;
    if (!credentials.refreshToken)
      throw new ConnectorError({
        category: "authorization",
        code: "x_refresh_token_missing",
        disposition: "reconnect",
        message: "X authorization expired; reconnect X Bookmarks.",
        status: 401,
      });
    const parameters = new URLSearchParams({
      client_id: options.clientId,
      grant_type: "refresh_token",
      refresh_token: credentials.refreshToken,
    });
    const refreshed = await exchange(parameters);
    return { ...refreshed, refreshToken: refreshed.refreshToken || credentials.refreshToken };
  }

  async function authenticatedRequest(credentials: XCredentials, url: URL) {
    const current = await validCredentials(credentials);
    const response = await providerFetch(request, url, {
      headers: { authorization: `Bearer ${current.accessToken}` },
    });
    return { credentials: current, value: await parseResponse(response) };
  }

  return {
    authorizationUrl(state, codeVerifier) {
      requireConfiguration();
      const url = new URL("https://x.com/i/oauth2/authorize");
      url.search = new URLSearchParams({
        client_id: options.clientId,
        code_challenge: base64Url(createHash("sha256").update(codeVerifier).digest()),
        code_challenge_method: "S256",
        redirect_uri: options.redirectUri,
        response_type: "code",
        scope: "bookmark.read tweet.read users.read offline.access",
        state,
      }).toString();
      return url.toString();
    },
    async exchangeCode(code, codeVerifier) {
      return exchange(
        new URLSearchParams({
          client_id: options.clientId,
          code,
          code_verifier: codeVerifier,
          grant_type: "authorization_code",
          redirect_uri: options.redirectUri,
        }),
      );
    },
    async getProfile(credentials) {
      const result = await authenticatedRequest(
        credentials,
        new URL("https://api.x.com/2/users/me"),
      );
      const profile = profileSchema.parse(result.value).data;
      return {
        credentials: result.credentials,
        value: { id: profile.id, name: profile.name ?? null, username: profile.username },
      };
    },
    async listBookmarkFolders(credentials, userId) {
      let current = credentials;
      let nextToken: string | undefined;
      const folders: XBookmarkFolder[] = [];
      do {
        const url = new URL(
          `https://api.x.com/2/users/${encodeURIComponent(userId)}/bookmarks/folders`,
        );
        url.searchParams.set("max_results", "100");
        if (nextToken) url.searchParams.set("pagination_token", nextToken);
        const result = await authenticatedRequest(current, url);
        current = result.credentials;
        const page = foldersSchema.parse(result.value);
        folders.push(...page.data);
        nextToken = page.meta?.next_token;
      } while (nextToken);
      return { credentials: current, value: folders };
    },
    async listFolderBookmarks(credentials, userId, folderId) {
      let current = credentials;
      let nextToken: string | undefined;
      const bookmarks: XBookmark[] = [];
      do {
        const url = new URL(
          `https://api.x.com/2/users/${encodeURIComponent(userId)}/bookmarks/folders/${encodeURIComponent(folderId)}`,
        );
        url.searchParams.set("max_results", "100");
        url.searchParams.set("tweet.fields", "author_id,created_at");
        url.searchParams.set("expansions", "author_id");
        url.searchParams.set("user.fields", "name,username");
        if (nextToken) url.searchParams.set("pagination_token", nextToken);
        const result = await authenticatedRequest(current, url);
        current = result.credentials;
        const page = postsSchema.parse(result.value);
        const authors = new Map(page.includes?.users.map((user) => [user.id, user]) ?? []);
        bookmarks.push(
          ...page.data.map((post) => {
            const author = post.author_id ? authors.get(post.author_id) : undefined;
            return {
              authorId: post.author_id ?? null,
              authorName: author?.name ?? null,
              authorUsername: author?.username ?? null,
              postedAt: post.created_at ? new Date(post.created_at) : null,
              raw: post,
              remotePostId: post.id,
              text: post.text,
              url: `https://x.com/${author?.username ?? "i"}/status/${post.id}`,
            };
          }),
        );
        nextToken = page.meta?.next_token;
      } while (nextToken);
      return { credentials: current, value: bookmarks };
    },
  };
}
