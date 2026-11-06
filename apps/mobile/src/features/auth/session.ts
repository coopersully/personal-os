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
      if (body.length > 64_000) throw new Error("The session response was too large.");
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
        options.onChange({ status: "signedIn", user });
      }),
    revalidate: () =>
      busy
        ? Promise.resolve()
        : exclusive(async () => {
            if (!token) return;
            try {
              options.onChange({ status: "signedIn", user: await client().getMe() });
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
