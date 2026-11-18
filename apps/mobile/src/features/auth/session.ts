import { ApiClientError, createApiClient } from "@personal-os/api-client";
import type { LoginInput, User } from "@personal-os/domain";

export interface SessionStorage {
  read(): Promise<string | null>;
  write(token: string | null): Promise<void>;
}
export type SessionState =
  | { status: "checking" | "signedOut" | "unavailable"; user: null }
  | { status: "signedIn"; user: User };

export function resolveApiOrigin(value: string) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("The API URL must be an origin without credentials or a path.");
  }
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  ) {
    throw new Error("The API requires HTTPS.");
  }
  return url.origin;
}

/** Uses the same expiring, revocable human sessions as web; no persisted user data. */
export function createSession(options: {
  origin: string;
  storage: SessionStorage;
  fetch?: typeof globalThis.fetch;
  onChange: (state: SessionState) => void;
}) {
  const origin = resolveApiOrigin(options.origin);
  let token: string | null = null;
  let busy = false;
  let epoch = 0;
  let userVersion = 0;
  const transport: typeof fetch = async (input, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await (options.fetch ?? globalThis.fetch)(input, {
        ...init,
        credentials: "omit",
        redirect: "error",
        signal: controller.signal,
      });
      // Keep the deadline active until the body finishes, not just response headers.
      const body = await response.text();
      const path = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      ).pathname;
      const maximum = path.startsWith("/v1/auth/") || path === "/v1/me" ? 64_000 : 2_000_000;
      if (body.length > maximum) throw new Error("The API response was too large.");
      return new Response(body || null, { status: response.status, headers: response.headers });
    } finally {
      clearTimeout(timer);
    }
  };
  const client = () =>
    createApiClient({
      baseUrl: origin,
      fetch: transport,
      ...(token ? { sessionToken: token } : {}),
    });
  const signedOut = async () => {
    // Clear visible identity even if Keychain removal fails; never expose a stale owner.
    token = null;
    epoch += 1;
    options.onChange({ status: "signedOut", user: null });
    await options.storage.write(null);
  };
  const exclusive = async (action: () => Promise<void>) => {
    if (busy) throw new Error("A session operation is already in progress.");
    busy = true;
    try {
      await action();
    } finally {
      busy = false;
    }
  };
  return {
    epoch: () => epoch,
    /** Apply only a server-returned User from this exact human session. */
    acceptUserUpdate: (user: User, expectedEpoch: number) => {
      if (!token || epoch !== expectedEpoch) return false;
      userVersion += 1;
      options.onChange({ status: "signedIn", user });
      return true;
    },
    api: () => {
      const ownerToken = token;
      if (!ownerToken) throw new Error("Sign in to continue.");
      return createApiClient({
        baseUrl: origin,
        sessionToken: ownerToken,
        fetch: async (input, init) => {
          if (token !== ownerToken) throw new Error("Your session changed. Please try again.");
          const response = await transport(input, init);
          if (token !== ownerToken) throw new Error("Your session changed. Please try again.");
          if (response.status === 401) await signedOut();
          return response;
        },
      });
    },
    restore: () =>
      busy
        ? Promise.resolve()
        : exclusive(async () => {
            options.onChange({ status: "checking", user: null });
            try {
              token = await options.storage.read();
              if (!token) {
                options.onChange({ status: "signedOut", user: null });
                return;
              }
              const user = await client().getMe();
              options.onChange({ status: "signedIn", user });
            } catch (error) {
              if (error instanceof ApiClientError && error.status === 401) await signedOut();
              else {
                options.onChange({ status: "unavailable", user: null });
                throw error;
              }
            }
          }),
    login: (input: LoginInput) =>
      exclusive(async () => {
        let issued: string | null = null;
        const api = createApiClient({
          baseUrl: origin,
          fetch: transport,
          onSessionToken: (value) => {
            issued = value;
          },
        });
        const user = await api.login(input);
        if (!issued) throw new Error("The server did not return a session.");
        try {
          await options.storage.write(issued);
        } catch (error) {
          await api.logout().catch(() => {});
          throw error;
        }
        token = issued;
        epoch += 1;
        options.onChange({ status: "signedIn", user });
      }),
    revalidate: () =>
      busy
        ? Promise.resolve()
        : exclusive(async () => {
            if (!token) return;
            try {
              const version = userVersion;
              const user = await client().getMe();
              if (version === userVersion) options.onChange({ status: "signedIn", user });
            } catch (error) {
              if (error instanceof ApiClientError && error.status === 401) await signedOut();
              else throw error;
            }
          }),
    logout: () =>
      exclusive(async () => {
        if (token) {
          try {
            await client().logout();
          } catch (error) {
            if (!(error instanceof ApiClientError && error.status === 401)) throw error;
          }
        }
        await signedOut();
      }),
    recover: (email: string) => client().requestPasswordReset({ email }),
  };
}
