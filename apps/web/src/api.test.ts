// @vitest-environment jsdom

const user = {
  accentColor: "#c7d23c",
  emailVerified: true,
  id: "11111111-1111-4111-8111-111111111111",
  setup: {
    completedAt: "2026-07-13T12:00:00.000Z",
    currentStep: "ready",
    dismissedAt: null,
    selectedWorkspaces: ["calendar", "tasks", "mail", "finances"],
    startedAt: "2026-07-13T12:00:00.000Z",
    status: "complete",
  },
  displayName: "Test User",
  email: "test@example.com",
  theme: "system",
  planningTimezone: "UTC",
  homeLocation: null,
  createdAt: "2026-07-13T12:00:00.000Z",
  updatedAt: "2026-07-13T12:00:00.000Z",
};

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("localStorage", memoryStorage());
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});

describe("web API adapter", () => {
  it("uses browser cookie auth and formats errors", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "");
    const fetch = vi.fn(async () => Response.json({ sessionToken: "sess_browser", user }));
    vi.stubGlobal("fetch", fetch);
    const { api, apiBaseUrl, errorMessage, isUnauthorized } = await import("./api.js");
    const { ApiClientError } = await import("@personal-os/api-client");

    await expect(api.login({ email: user.email, password: "LocalTestOnly123!" })).resolves.toEqual(
      user,
    );
    expect(localStorage.getItem("personal-os.desktop-session")).toBeNull();
    expect(errorMessage(new Error("Readable"))).toBe("Readable");
    expect(errorMessage({ reason: "opaque" })).toBe("Something went wrong. Please try again.");
    expect(
      isUnauthorized(new ApiClientError({ code: "unauthorized", message: "No", status: 401 })),
    ).toBe(true);
    expect(
      isUnauthorized(new ApiClientError({ code: "forbidden", message: "No", status: 403 })),
    ).toBe(false);
    expect(isUnauthorized(new Error("unauthorized"))).toBe(false);
    expect(apiBaseUrl(undefined, false)).toBe(window.location.origin);
    expect(apiBaseUrl(undefined, true)).toBe("https://api.ilo.coopersully.me");
    expect(apiBaseUrl("https://configured.test", false)).toBe("https://configured.test");
  });

  it("honors an explicitly configured API origin in the browser", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.personal-os.test");
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json({ user }),
    );
    vi.stubGlobal("fetch", fetch);
    const { api } = await import("./api.js");

    await api.getMe();
    expect(String(fetch.mock.calls[0]?.[0])).toBe("https://api.personal-os.test/v1/me");
  });

  it("uses native transport without renderer credentials", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    const invoke = vi.fn(async (command: string, args?: unknown) => {
      if (command === "desktop_settings") return { settings: { serverUrl: "https://custom.test" } };
      const request = (args as { request: { path: string } }).request;
      return {
        status: request.path === "/v1/auth/logout" ? 204 : 200,
        body: JSON.stringify({ user }),
      };
    });
    vi.doMock("@tauri-apps/api/core", () => ({ invoke }));
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { api } = await import("./api.js");
    await api.login({ email: user.email, password: "LocalTestOnly123!" });
    await api.getMe();
    await api.logout();
    expect(fetch).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(invoke).toHaveBeenCalledWith("desktop_request", {
      request: {
        serverUrl: "https://custom.test",
        path: "/v1/me",
        method: "GET",
        body: null,
      },
    });
  });
});
