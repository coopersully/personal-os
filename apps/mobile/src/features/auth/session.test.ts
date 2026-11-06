import type { User } from "@personal-os/domain";
import { describe, expect, it, vi } from "vitest";
import { createSession, resolveApiOrigin, type SessionState } from "./session";

const user = { id: "owner-a", displayName: "Test person", email: "person@example.test" } as User;
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const denied = () =>
  new Response(JSON.stringify({ error: { code: "unauthorized" } }), { status: 401 });
function setup(saved: string | null = null) {
  const storage = {
    read: vi.fn(async () => saved),
    write: vi.fn(async (value: string | null) => {
      saved = value;
    }),
  };
  const fetch = vi.fn<typeof globalThis.fetch>();
  const states: SessionState[] = [];
  const session = createSession({
    origin: "https://api.example.test",
    storage,
    fetch: fetch as typeof globalThis.fetch,
    onChange: (state) => states.push(state),
  });
  return { session, storage, fetch, states, saved: () => saved };
}
describe("native human sessions", () => {
  it("persists only the issued token and uses Session auth to revoke it", async () => {
    const t = setup();
    t.fetch
      .mockResolvedValueOnce(ok({ sessionToken: "sess-test", user }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await t.session.login({ email: user.email, password: "test-password" });
    expect(t.saved()).toBe("sess-test");
    expect(t.states.at(-1)).toEqual({ status: "signedIn", user });
    await t.session.logout();
    const init = t.fetch.mock.calls[1]?.[1];
    expect(new Headers(init?.headers).get("authorization")).toBe("Session sess-test");
    expect(init?.credentials).toBe("omit");
    expect(init?.redirect).toBe("error");
    expect(t.saved()).toBeNull();
    expect(t.states.at(-1)?.status).toBe("signedOut");
  });
  it("revalidates a stored token before exposing an owner", async () => {
    const t = setup("sess-old");
    t.fetch.mockResolvedValueOnce(ok({ user }));
    await t.session.restore();
    expect(t.fetch.mock.calls[0]?.[0]).toBe("https://api.example.test/v1/me");
    expect(t.states.map((state) => state.status)).toEqual(["checking", "signedIn"]);
  });
  it("purges expired sessions without restoring cached identity", async () => {
    const t = setup("sess-expired");
    t.fetch.mockResolvedValueOnce(denied());
    await t.session.restore();
    expect(t.saved()).toBeNull();
    expect(t.states.at(-1)).toEqual({ status: "signedOut", user: null });
  });
  it("locks restore on network failure while preserving the token for retry", async () => {
    const t = setup("sess-valid");
    t.fetch.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(ok({ user }));
    await expect(t.session.restore()).rejects.toThrow("offline");
    expect(t.states.at(-1)).toEqual({ status: "unavailable", user: null });
    expect(t.saved()).toBe("sess-valid");
    await t.session.restore();
    expect(t.states.at(-1)?.status).toBe("signedIn");
  });
  it("does not claim logout on network failure", async () => {
    const t = setup("sess-valid");
    t.fetch.mockResolvedValueOnce(ok({ user })).mockRejectedValueOnce(new Error("offline"));
    await t.session.restore();
    await expect(t.session.logout()).rejects.toThrow("offline");
    expect(t.saved()).toBe("sess-valid");
    expect(t.states.at(-1)?.status).toBe("signedIn");
  });
  it("clears owner identity after foreground expiry", async () => {
    const t = setup("sess-valid");
    t.fetch.mockResolvedValueOnce(ok({ user })).mockResolvedValueOnce(denied());
    await t.session.restore();
    await t.session.revalidate();
    expect(t.saved()).toBeNull();
    expect(t.states.at(-1)?.status).toBe("signedOut");
  });
  it("does not authenticate if Keychain persistence fails; revokes the issued token", async () => {
    const t = setup();
    t.storage.write.mockRejectedValueOnce(new Error("keychain unavailable"));
    t.fetch
      .mockResolvedValueOnce(ok({ sessionToken: "sess-new", user }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(t.session.login({ email: user.email, password: "test-password" })).rejects.toThrow(
      "keychain unavailable",
    );
    expect(t.states).toEqual([]);
    expect(t.fetch.mock.calls[1]?.[0]).toBe("https://api.example.test/v1/auth/logout");
  });
  it("rejects concurrent session operations instead of reporting false success", async () => {
    const t = setup();
    let finish!: (response: Response) => void;
    t.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const login = t.session.login({ email: user.email, password: "test-password" });
    await expect(t.session.logout()).rejects.toThrow("already in progress");
    finish(ok({ sessionToken: "sess-new", user }));
    await login;
    expect(t.states.at(-1)?.status).toBe("signedIn");
  });
  it("bounds network waits and leaves restore retryable", async () => {
    vi.useFakeTimers();
    try {
      const t = setup("sess-valid");
      t.fetch.mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("timed out")));
          }),
      );
      const result = expect(t.session.restore()).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(15_000);
      await result;
      expect(t.states.at(-1)?.status).toBe("unavailable");
      expect(t.saved()).toBe("sess-valid");
    } finally {
      vi.useRealTimers();
    }
  });
  it("treats an already revoked logout as signed out", async () => {
    const t = setup("sess-old");
    t.fetch.mockResolvedValueOnce(ok({ user })).mockResolvedValueOnce(denied());
    await t.session.restore();
    await t.session.logout();
    expect(t.saved()).toBeNull();
    expect(t.states.at(-1)?.status).toBe("signedOut");
  });
  it("authenticates workspace reads and clears the session on API expiry", async () => {
    const t = setup("sess-valid");
    t.fetch.mockResolvedValueOnce(ok({ user })).mockResolvedValueOnce(denied());
    await t.session.restore();
    await expect(t.session.api().listTaskLists({ limit: 100 })).rejects.toThrow();
    expect(new Headers(t.fetch.mock.calls[1]?.[1]?.headers).get("authorization")).toBe(
      "Session sess-valid",
    );
    expect(t.saved()).toBeNull();
    expect(() => t.session.api()).toThrow("Sign in");
  });
  it("rejects a late workspace response after logout", async () => {
    const t = setup("sess-valid");
    let finish!: (response: Response) => void;
    t.fetch.mockResolvedValueOnce(ok({ user }));
    await t.session.restore();
    const api = t.session.api();
    t.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const request = api.listTaskLists({ limit: 100 });
    t.fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await t.session.logout();
    const rejected = expect(request).rejects.toThrow("session changed");
    finish(ok({ items: [], nextCursor: null }));
    await rejected;
    await expect(api.listTaskLists({ limit: 100 })).rejects.toThrow("session changed");
  });
  it("rejects insecure and credential-bearing API origins", () => {
    for (const origin of [
      "http://api.example.test",
      "https://a:b@api.example.test",
      "https://api.example.test/path",
      "https://api.example.test/?token=x",
    ])
      expect(() => resolveApiOrigin(origin)).toThrow();
    expect(resolveApiOrigin("http://localhost:8000")).toBe("http://localhost:8000");
  });
});
