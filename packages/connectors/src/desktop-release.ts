import type { DesktopRelease, DesktopReleaseStatus } from "@personal-os/domain";
import { z } from "zod";
import { providerFetch } from "./http.js";

const repository = "https://github.com/coopersully/personal-os/releases";
const schema = z.object({
  tag_name: z.string().regex(/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/),
  draft: z.literal(false),
  prerelease: z.literal(false),
  published_at: z.iso.datetime({ offset: true }),
  html_url: z.string(),
  body: z.string().max(100_000).nullable(),
  assets: z.array(z.object({ name: z.string(), browser_download_url: z.string() })).max(100),
});
export function parseDesktopRelease(input: unknown): DesktopRelease {
  const value = schema.parse(input);
  const version = value.tag_name.slice(1);
  if (value.html_url !== `${repository}/tag/${value.tag_name}`)
    throw new Error("Unexpected release URL");
  const artifact = (name: string) => {
    const assets = value.assets.filter((asset) => asset.name === name);
    const expected = `${repository}/download/${value.tag_name}/${name}`;
    if (assets.length !== 1 || assets[0]?.browser_download_url !== expected)
      throw new Error("Incomplete release");
    return expected;
  };
  artifact("latest.json");
  const installers = (["aarch64", "x86_64"] as const).map((architecture) => {
    const name = `nohmi_${version}_${architecture}`;
    artifact(`${name}.app.tar.gz`);
    artifact(`${name}.app.tar.gz.sig`);
    return { architecture, url: artifact(`${name}.dmg`) };
  });
  return {
    version,
    publishedAt: value.published_at,
    notes: value.body ?? "",
    releaseUrl: value.html_url,
    installers,
  };
}
export function createDesktopReleaseReader(
  request: typeof fetch = globalThis.fetch,
  now = Date.now,
) {
  let cached: { until: number; value: DesktopReleaseStatus } | undefined;
  let pending: Promise<DesktopReleaseStatus> | undefined;
  async function load(): Promise<DesktopReleaseStatus> {
    try {
      const response = await providerFetch(
        request,
        "https://api.github.com/repos/coopersully/personal-os/releases/latest",
        {
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "nohmi-release-metadata",
          },
          redirect: "error",
        },
        5_000,
      );
      if (response.status === 404) return { status: "not_published", release: null };
      if (!response.ok || !response.body) throw new Error("Release unavailable");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > 1_048_576) throw new Error("Release metadata too large");
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const release = parseDesktopRelease(JSON.parse(new TextDecoder().decode(bytes)));
      return { status: "available", release };
    } catch {
      return { status: "unavailable", release: null };
    }
  }
  return (): Promise<DesktopReleaseStatus> => {
    if (cached && cached.until > now()) return Promise.resolve(cached.value);
    pending ??= load()
      .then((value) => {
        cached = { until: now() + (value.status === "unavailable" ? 30_000 : 300_000), value };
        return value;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
}
