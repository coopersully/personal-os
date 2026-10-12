import { describe, expect, it, vi } from "vitest";
import { createDesktopReleaseReader, parseDesktopRelease } from "./desktop-release.js";

const base = "https://github.com/coopersully/personal-os/releases";
const fixture = () => ({
  tag_name: "v0.1.0",
  draft: false,
  prerelease: false,
  published_at: "2026-09-30T12:00:00Z",
  html_url: `${base}/tag/v0.1.0`,
  body: "New release",
  assets: ["aarch64", "x86_64"]
    .flatMap((arch) =>
      [".dmg", ".app.tar.gz", ".app.tar.gz.sig"].map((suffix) => ({
        name: `nohmi_0.1.0_${arch}${suffix}`,
        browser_download_url: `${base}/download/v0.1.0/nohmi_0.1.0_${arch}${suffix}`,
      })),
    )
    .concat([{ name: "latest.json", browser_download_url: `${base}/download/v0.1.0/latest.json` }]),
});
describe("desktop release metadata", () => {
  it("accepts only complete stable official releases", () => {
    expect(parseDesktopRelease(fixture()).installers).toHaveLength(2);
  });
  it("rejects foreign assets, drafts, partial and mismatched versions", () => {
    for (const change of [
      { draft: true },
      { prerelease: true },
      { tag_name: "v0.2.0" },
      { published_at: "bad" },
      { assets: [] },
      { html_url: "https://evil.test" },
    ])
      expect(() => parseDesktopRelease({ ...fixture(), ...change })).toThrow();
    const value = fixture();
    const first = value.assets.at(0);
    if (!first) throw new Error("Missing fixture");
    first.browser_download_url = "https://evil.test/nohmi.dmg";
    expect(() => parseDesktopRelease(value)).toThrow();
  });
  it("coalesces reads and caches success for five minutes", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(fixture())));
    const read = createDesktopReleaseReader(fetcher);
    const [a, b] = await Promise.all([read(), read()]);
    expect(a).toEqual(b);
    expect(a.status).toBe("available");
    await read();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("distinguishes unpublished from network failure and bounds payloads", async () => {
    for (const [response, status] of [
      [new Response(null, { status: 404 }), "not_published"],
      [new Response(null, { status: 503 }), "unavailable"],
      [new Response("{bad"), "unavailable"],
      [new Response("x".repeat(1_048_577)), "unavailable"],
    ] as const)
      expect((await createDesktopReleaseReader(vi.fn().mockResolvedValue(response))()).status).toBe(
        status,
      );
    expect(
      (await createDesktopReleaseReader(vi.fn().mockRejectedValue(new Error("offline")))()).status,
    ).toBe("unavailable");
  });
});

it("reports redacted failure categories once per upstream attempt, not cached read", async () => {
  const secret = "private upstream content";
  for (const [response, reason, status] of [
    [new Response(secret, { status: 429 }), "http", 429],
    [new Response(null), "body", 200],
    [new Response("x".repeat(1_048_577)), "body", 200],
    [new Response(secret), "metadata", 200],
  ] as const) {
    const observe = vi.fn();
    const read = createDesktopReleaseReader(vi.fn().mockResolvedValue(response), Date.now, observe);
    expect(await read()).toEqual({ status: "unavailable", release: null });
    await read();
    expect(observe).toHaveBeenCalledExactlyOnceWith({
      reason,
      status,
      durationMs: expect.any(Number),
    });
    expect(JSON.stringify(observe.mock.calls)).not.toContain(secret);
  }
  for (const [error, reason] of [
    [new Error(secret), "transport"],
    [new DOMException(secret, "TimeoutError"), "timeout"],
  ] as const) {
    const observe = vi.fn();
    await createDesktopReleaseReader(vi.fn().mockRejectedValue(error), Date.now, observe)();
    expect(observe).toHaveBeenCalledExactlyOnceWith({
      reason,
      status: 0,
      durationMs: expect.any(Number),
    });
  }
  const observe = vi.fn();
  await createDesktopReleaseReader(
    vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
    Date.now,
    observe,
  )();
  expect(observe).not.toHaveBeenCalled();
});
