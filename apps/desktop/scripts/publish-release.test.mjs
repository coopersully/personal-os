import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { productionReady, publishRelease } from "./publish-release.mjs";

const source = "a".repeat(40);
async function scenario({
  existing,
  state = "success",
  main = source,
  automatic = true,
  enabled = true,
  timedOut = false,
  incomplete = false,
  supersedeDuringProbe = false,
  publishTimeout = false,
  confirmedMismatch = false,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "nohmi-publish-test-"));
  const cwd = process.cwd();
  const calls = [];
  let time = 0;
  try {
    process.chdir(root);
    mkdirSync("release-assets");
    writeFileSync("release-assets/latest.json", "{}");
    await publishRelease({
      env: {
        RELEASE_TAG: "v0.1.1",
        SOURCE_SHA: source,
        AUTOMATIC: String(automatic),
        AUTO_PUBLISH_ENABLED: String(enabled),
      },
      command: () => {
        if (incomplete) throw new Error("Missing Intel artifact");
      },
      github: (...args) => {
        calls.push(args);
        if (args.includes("api")) {
          const path = args.find((arg) => arg.startsWith("repos/"));
          if (path.endsWith("generate-notes")) return JSON.stringify({ body: "Release notes" });
          if (path.includes("releases?")) return JSON.stringify([existing ? [existing] : []]);
          if (path.includes("releases/tags/"))
            return JSON.stringify({
              tag_name: "v0.1.1",
              draft: false,
              prerelease: false,
              body: readFileSync("release-notes.md", "utf8"),
              assets: [
                {
                  name: "latest.json",
                  state: "uploaded",
                  digest: confirmedMismatch
                    ? "sha256:wrong"
                    : `sha256:${createHash("sha256").update(readFileSync("release-assets/latest.json")).digest("hex")}`,
                },
              ],
            });
          if (path.endsWith("heads/main")) return JSON.stringify({ object: { sha: main } });
          throw new Error(`Unexpected API request ${path}`);
        }
        if (publishTimeout && args.includes("--draft=false")) throw new Error("Publish timed out");
        return "";
      },
      deploymentReady: async () => {
        if (supersedeDuringProbe) main = "b".repeat(40);
        return state === "success";
      },
      now: () => {
        time += timedOut ? 271 * 60_000 : 0;
        return time;
      },
      sleep: () => {
        throw new Error("Unexpected unbounded wait");
      },
    });
    return calls;
  } catch (error) {
    error.calls = calls;
    throw error;
  } finally {
    process.chdir(cwd);
    rmSync(root, { recursive: true, force: true });
  }
}
const published = (calls) => calls.some((args) => args.includes("--draft=false"));
test("publishes complete automatic release only after source deployment succeeds", async () => {
  const calls = await scenario();
  assert.equal(published(calls), true);
  assert.ok(
    calls.findIndex((a) => a.includes("--draft")) <
      calls.findIndex((a) => a.includes("--draft=false")),
  );
});
test("manual tag remains draft", async () => {
  assert.equal(published(await scenario({ automatic: false })), false);
});
test("superseded source remains draft", async () => {
  assert.equal(published(await scenario({ main: "b".repeat(40) })), false);
});
test("source superseded during the production probe remains draft", async () => {
  assert.equal(published(await scenario({ supersedeDuringProbe: true })), false);
});
test("failed, missing or timed-out deployment cannot publish", async () => {
  for (const state of ["failure", "error", undefined, "pending"]) {
    await assert.rejects(
      scenario({ state: state ?? null, timedOut: true }),
      (error) => !published(error.calls),
    );
  }
});
test("existing draft can recover uploads without recreating its tag", async () => {
  const calls = await scenario({ existing: { tag_name: "v0.1.1", draft: true } });
  assert.ok(calls.some((a) => a.includes("--clobber")));
  assert.ok(!calls.some((a) => a.includes("create")));
  assert.equal(published(calls), true);
});
test("already public assets are immutable", async () => {
  await assert.rejects(
    scenario({ existing: { tag_name: "v0.1.1", draft: false } }),
    (error) => /immutable/.test(error.message) && !error.calls.some((a) => a[0] === "release"),
  );
});
test("incomplete artifact set fails before any release mutation", async () => {
  await assert.rejects(
    scenario({ incomplete: true }),
    (error) => /Missing Intel/.test(error.message) && !error.calls.some((a) => a[0] === "release"),
  );
});

test("initial rollout switch keeps automatically packaged releases in draft", async () => {
  assert.equal(published(await scenario({ enabled: false })), false);
});

test("older versions cannot become latest after a newer public release", async () => {
  await assert.rejects(
    scenario({ existing: { tag_name: "v0.2.0", draft: false } }),
    (error) => /newer public/.test(error.message) && !error.calls.some((a) => a[0] === "release"),
  );
});

test("public deployment probe requires matching ready revision without credentials", async () => {
  let seen;
  assert.equal(
    await productionReady(source, async (url, options) => {
      seen = { url, options };
      return Response.json({ status: "ready", revision: source });
    }),
    true,
  );
  assert.equal(seen.url, `https://nohmi-api.coopersully.me/health/ready?release=${source}`);
  assert.equal(seen.options.redirect, "error");
  assert.equal(seen.options.cache, "no-store");
  assert.equal(seen.options.headers, undefined);
  assert.ok(seen.options.signal instanceof AbortSignal);
  for (const response of [
    Response.json({ status: "ready" }),
    Response.json({ status: "ready", revision: "b".repeat(40) }),
    Response.json({ status: "failed", revision: source }),
    new Response("bad json"),
    new Response("x".repeat(4097)),
    new Response("unavailable", { status: 503 }),
  ]) {
    assert.equal(await productionReady(source, async () => response), false);
  }
  assert.equal(
    await productionReady(source, async () => {
      throw new Error("network timeout");
    }),
    false,
  );
});

test("reconciles a publish timeout only when public source notes and every uploaded digest match", async () => {
  assert.equal(published(await scenario({ publishTimeout: true })), true);
  await assert.rejects(
    scenario({ publishTimeout: true, confirmedMismatch: true }),
    /Publish timed out/,
  );
});
