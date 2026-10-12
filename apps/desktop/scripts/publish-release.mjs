import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { compareVersions, stableTag } from "./automatic-release.mjs";

const run = (command, args) =>
  execFileSync(command, args, { encoding: "utf8", timeout: 60_000 }).trim();
const gh = (...args) => run("gh", args);
const repo = "coopersully/personal-os";
export async function productionReady(source, request = fetch) {
  try {
    const response = await request(
      `https://nohmi-api.coopersully.me/health/ready?release=${source}`,
      {
        signal: AbortSignal.timeout(8_000),
        redirect: "error",
        cache: "no-store",
      },
    );
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      return false;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = "",
      size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 4096) {
          await reader.cancel();
          return false;
        }
        text += decoder.decode(value, { stream: true });
      }
      const body = JSON.parse(text + decoder.decode());
      return body.status === "ready" && body.revision === source;
    } finally {
      reader.releaseLock();
    }
  } catch {
    return false;
  }
}

export async function publishRelease({
  env = process.env,
  command = run,
  github = gh,
  sleep = setTimeout,
  now = Date.now,
  deploymentReady = productionReady,
} = {}) {
  const tag = env.RELEASE_TAG;
  if (!stableTag.test(tag ?? "")) throw new Error("Stable tag required");
  const automatic = env.AUTOMATIC === "true";
  const source = env.SOURCE_SHA;
  if (automatic && !/^[0-9a-f]{40}$/.test(source ?? ""))
    throw new Error("Verified source required");
  const notes = JSON.parse(
    github("api", `repos/${repo}/releases/generate-notes`, "-f", `tag_name=${tag}`),
  ).body;
  writeFileSync(
    "release-notes.md",
    `${notes}\n${automatic ? `\nVerified source: ${source}\n` : ""}`,
  );
  command("node", [
    "apps/desktop/scripts/release-metadata.mjs",
    tag,
    "release-assets",
    "release-notes.md",
  ]);
  const releases = JSON.parse(
    github("api", "--paginate", "--slurp", `repos/${repo}/releases?per_page=100`),
  ).flat();
  if (
    releases.some(
      (release) =>
        !release.draft &&
        !release.prerelease &&
        stableTag.test(release.tag_name) &&
        compareVersions(release.tag_name, tag) > 0,
    )
  ) {
    throw new Error("A newer public version already exists; refusing to regress latest");
  }
  const existing = releases.find((release) => release.tag_name === tag);
  if (existing && !existing.draft)
    throw new Error("Public releases are immutable; refusing to replace assets");
  const assets = readdirSync("release-assets").map((file) => `release-assets/${file}`);
  if (existing) {
    github("release", "upload", tag, ...assets, "--clobber");
    github("release", "edit", tag, "--notes-file", "release-notes.md");
  } else {
    github(
      "release",
      "create",
      tag,
      "--verify-tag",
      "--draft",
      "--title",
      `nohmi ${tag}`,
      "--notes-file",
      "release-notes.md",
      ...assets,
    );
  }
  if (automatic && env.AUTO_PUBLISH_ENABLED === "true") {
    // CI and production deploy run independently. Never offer a client before its API is live.
    const deadline = now() + 270 * 60_000;
    while (true) {
      const ready = await deploymentReady(source);
      const main = JSON.parse(github("api", `repos/${repo}/git/ref/heads/main`)).object.sha;
      if (main !== source) {
        console.log("Source superseded: keeping the complete release as a draft");
        break;
      }
      if (ready) {
        try {
          github("release", "edit", tag, "--draft=false", "--latest");
        } catch (error) {
          // A timeout can follow a successful server-side publication. Confirm the
          // exact uploaded bytes and notes, without mutating an already-public release.
          const confirmed = JSON.parse(github("api", `repos/${repo}/releases/tags/${tag}`));
          const matches =
            confirmed.tag_name === tag &&
            confirmed.draft === false &&
            confirmed.prerelease === false &&
            confirmed.body === readFileSync("release-notes.md", "utf8") &&
            confirmed.assets?.length === assets.length &&
            assets.every((path) => {
              const name = path.slice("release-assets/".length);
              const found = confirmed.assets.filter((asset) => asset.name === name);
              return (
                found.length === 1 &&
                found[0].state === "uploaded" &&
                found[0].digest ===
                  `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`
              );
            });
          if (!matches) throw error;
          console.log(`Confirmed ${tag} was published despite the command failure`);
        }
        console.log(`Published ${tag}: installers and automatic updates are live`);
        break;
      }
      if (now() >= deadline)
        throw new Error("Production deployment deadline exceeded; release remains draft");
      await sleep(30_000);
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await publishRelease();
}
