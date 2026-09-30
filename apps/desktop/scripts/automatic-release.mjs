import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const stableTag = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function compareVersions(a, b) {
  const left = a.replace(/^v/, "").split(".").map(Number);
  const right = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
}
export function affectsDesktop(path) {
  if (/\.(md|test\.[cm]?[jt]sx?)$/.test(path)) return false;
  return (
    /^(apps\/(desktop|web)\/|packages\/|patches\/)/.test(path) ||
    /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig[^/]*\.json)$/.test(path) ||
    path === ".github/workflows/release.yml"
  );
}
export function nextVersion(floor, tags, messages) {
  if (!stableTag.test(`v${floor}`)) throw new Error("Invalid source version");
  const highest = [floor, ...tags.filter((tag) => stableTag.test(tag)).map((tag) => tag.slice(1))]
    .sort(compareVersions)
    .at(-1);
  const parts = highest.split(".").map(Number);
  const markers = [...messages.matchAll(/^Desktop-Release: (patch|minor|major)\s*$/gm)].map(
    (m) => m[1],
  );
  if (markers.includes("major")) return `${parts[0] + 1}.0.0`;
  if (markers.includes("minor")) return `${parts[0]}.${parts[1] + 1}.0`;
  return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
}
export function setVersions(version, root = ".") {
  if (!stableTag.test(`v${version}`)) throw new Error("Invalid release version");
  for (const path of ["apps/desktop/package.json", "apps/desktop/src-tauri/tauri.conf.json"]) {
    const file = resolve(root, path);
    const data = JSON.parse(readFileSync(file, "utf8"));
    data.version = version;
    writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  }
  for (const [path, pattern] of [
    ["apps/desktop/src-tauri/Cargo.toml", /^(version = ")[^"]+(".*)$/m],
    [
      "apps/desktop/src-tauri/Cargo.lock",
      /(\[\[package\]\]\nname = "personal-os"\nversion = ")[^"]+(")/,
    ],
  ]) {
    const file = resolve(root, path);
    const data = readFileSync(file, "utf8");
    if (!pattern.test(data)) throw new Error(`Missing version in ${path}`);
    writeFileSync(file, data.replace(pattern, `$1${version}$2`));
  }
}
const run = (command, args) =>
  execFileSync(command, args, { encoding: "utf8", timeout: 60_000 }).trim();
const git = (...args) => run("git", args);
const gh = (...args) => run("gh", args);
const output = (key, value) => appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
const repo = "coopersully/personal-os";
function sourceFor(tag) {
  const message = git("for-each-ref", "--format=%(contents)", `refs/tags/${tag}`);
  const source = message.match(/^Nohmi-Source: ([0-9a-f]{40})$/m)?.[1];
  if (source) {
    if (git("rev-parse", `${tag}^`) !== source) throw new Error("Release source parent mismatch");
    return source;
  }
  return git("rev-parse", `${tag}^{commit}`);
}
export function prepare() {
  const source = process.env.SOURCE_SHA;
  if (!/^[0-9a-f]{40}$/.test(source ?? "")) throw new Error("Full source SHA required");
  git("fetch", "origin", "main", "--tags");
  if (git("rev-parse", "origin/main") !== source) {
    output("build", "false");
    console.log("Superseded source; the next successful main CI run will reconcile releases");
    return;
  }
  if (git("rev-parse", "HEAD") !== source)
    throw new Error("Checkout does not match verified CI source");
  const releases = JSON.parse(
    gh("api", "--paginate", "--slurp", `repos/${repo}/releases?per_page=100`),
  ).flat();
  const published = releases
    .filter((r) => !r.draft && !r.prerelease && stableTag.test(r.tag_name))
    .sort((a, b) => compareVersions(a.tag_name, b.tag_name))
    .at(-1);
  const baseline = published ? sourceFor(published.tag_name) : null;
  if (baseline) git("merge-base", "--is-ancestor", baseline, source);
  const files = baseline
    ? git("diff", "--name-only", baseline, source).split("\n")
    : ["apps/desktop/package.json"];
  if (!files.some(affectsDesktop)) {
    output("build", "false");
    console.log("No desktop changes since the last public release");
    return;
  }
  const tags = git("tag", "--list", "v*")
    .split("\n")
    .filter((tag) => stableTag.test(tag))
    .sort(compareVersions);
  const highest = tags.at(-1);
  let tag;
  if (highest && sourceFor(highest) === source) {
    tag = highest;
    git("checkout", "--detach", tag);
  } else {
    const messages = git(
      "log",
      "--format=%B",
      "--grep=^Desktop-Release:",
      baseline ? `${baseline}..${source}` : source,
    );
    const floor = JSON.parse(readFileSync("apps/desktop/package.json", "utf8")).version;
    const version = nextVersion(floor, tags, messages);
    tag = `v${version}`;
    setVersions(version);
    git("config", "user.name", "github-actions[bot]");
    git("config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com");
    git(
      "add",
      "apps/desktop/package.json",
      "apps/desktop/src-tauri/tauri.conf.json",
      "apps/desktop/src-tauri/Cargo.toml",
      "apps/desktop/src-tauri/Cargo.lock",
    );
    git("commit", "-m", `Release nohmi ${tag}\n\nNohmi-Source: ${source}`);
    git("tag", "-a", tag, "-m", `nohmi ${tag}\n\nNohmi-Source: ${source}`);
    git("push", "origin", `refs/tags/${tag}`);
  }
  output("build", "true");
  output("tag", tag);
  output("ref", git("rev-parse", "HEAD"));
  output("source", source);
  console.log(`Reserved ${tag} for verified main source ${source}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) prepare();
