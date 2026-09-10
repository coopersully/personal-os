import { PROVIDER_REQUEST_TIMEOUT_MS, providerFetch } from "./http.js";

describe("provider HTTP requests", () => {
  it("adds the shared provider timeout without replacing a caller abort signal", async () => {
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Response.json({ ok: true });
    });
    const caller = new AbortController();

    await providerFetch(request, "https://provider.example.test", {
      method: "POST",
      signal: caller.signal,
    });

    expect(request).toHaveBeenCalledOnce();
    expect(PROVIDER_REQUEST_TIMEOUT_MS).toBeLessThan(60_000);
    expect(caller.signal.aborted).toBe(false);
  });
});
