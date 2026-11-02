import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  constants,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  opendirSync,
  openSync,
  readSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const LIMITS = Object.freeze({
  trace: 64 * 1024 * 1024,
  screenshot: 8 * 1024 * 1024,
  context: 1024 * 1024,
  total: 128 * 1024 * 1024,
  manifest: 64 * 1024,
  files: 64,
  entries: 512,
  depth: 4,
  path: 512,
});
const SHA = /^[a-f0-9]{40}$/u;
const ID = /^[1-9][0-9]*$/u;
const OUTCOMES = new Set(["success", "failure", "cancelled", "skipped", "unknown"]);
const hash = (data) => createHash("sha256").update(data).digest("hex");
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const POLICY = "local-e2e-fixtures";

class Rejected extends Error {
  constructor(reason, observedBytes) {
    super(reason);
    this.reason = reason;
    if (reason === "file_limit" && integer(observedBytes)) this.observedBytes = observedBytes;
  }
}

function directory(path) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== resolve(path)) {
    throw new Error("Unsafe browser diagnostic directory");
  }
  return stat;
}

function roots(options) {
  const workspace = realpathSync(options.workspace ?? process.cwd());
  const env = options.env ?? process.env;
  const runner = realpathSync(env.RUNNER_TEMP);
  directory(workspace);
  directory(runner);
  const staging = resolve(options.staging);
  if (dirname(staging) !== runner || staging !== join(runner, "browser-diagnostics")) {
    throw new Error("Unsafe staging directory");
  }
  return { workspace, staging, env };
}

// Open nonblocking before inspecting the descriptor: a FIFO must never hang the job.
function bytes(path, maximum, since, expectedParent) {
  let fd;
  let parentFd;
  try {
    parentFd = openSync(
      dirname(path),
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const parent = fstatSync(parentFd);
    if (
      !parent.isDirectory() ||
      (expectedParent && (parent.dev !== expectedParent.dev || parent.ino !== expectedParent.ino))
    )
      throw new Rejected("unsafe_directory");
    // The production collector is Linux. Anchor its read to the opened directory, not a
    // pathname that a concurrent process could replace. Other hosts retain inode fences.
    const anchored =
      process.platform === "linux" ? `/proc/self/fd/${parentFd}/${basename(path)}` : path;
    fd = openSync(anchored, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1) throw new Rejected("not_regular");
    if (!integer(stat.size)) throw new Rejected("invalid_size");
    if (stat.size > maximum) throw new Rejected("file_limit", stat.size);
    if (since !== undefined && stat.mtimeMs < since) throw new Rejected("stale");
    const buffer = Buffer.alloc(stat.size + 1);
    let size = 0;
    while (size < buffer.length) {
      const read = readSync(fd, buffer, size, buffer.length - size, null);
      if (!read) break;
      size += read;
    }
    const after = fstatSync(fd);
    const live = lstatSync(path);
    const currentParent = lstatSync(dirname(path));
    if (
      currentParent.isSymbolicLink() ||
      currentParent.dev !== parent.dev ||
      currentParent.ino !== parent.ino ||
      size !== stat.size ||
      after.size !== stat.size ||
      after.mtimeMs !== stat.mtimeMs ||
      after.ctimeMs !== stat.ctimeMs ||
      after.nlink !== 1 ||
      live.dev !== stat.dev ||
      live.ino !== stat.ino ||
      live.isSymbolicLink()
    ) {
      throw new Rejected("changed_during_read");
    }
    return buffer.subarray(0, size);
  } catch (error) {
    if (error instanceof Rejected) throw error;
    if (error.code === "ENOENT") throw new Rejected("absent");
    if (error.code === "ELOOP") throw new Rejected("symlink");
    throw new Rejected("read_failed");
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (parentFd !== undefined) closeSync(parentFd);
  }
}

function baseIdentity(workspace, env) {
  const runId = Number(env.GITHUB_RUN_ID);
  const runAttempt = Number(env.GITHUB_RUN_ATTEMPT);
  const repository = env.GITHUB_REPOSITORY;
  const event = env.GITHUB_EVENT_NAME;
  const job = env.GITHUB_JOB;
  const workflowRef = env.GITHUB_WORKFLOW_REF;
  const checkoutSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: workspace,
    encoding: "utf8",
    timeout: 15000,
  }).trim();
  if (
    !ID.test(env.GITHUB_RUN_ID ?? "") ||
    !ID.test(env.GITHUB_RUN_ATTEMPT ?? "") ||
    !Number.isSafeInteger(runId) ||
    !Number.isSafeInteger(runAttempt) ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository ?? "") ||
    !/^[A-Za-z_][A-Za-z0-9_-]{0,99}$/u.test(job ?? "") ||
    !["pull_request", "push"].includes(event) ||
    !SHA.test(env.GITHUB_WORKFLOW_SHA ?? "") ||
    !SHA.test(env.GITHUB_SHA ?? "") ||
    checkoutSha !== env.GITHUB_SHA ||
    typeof workflowRef !== "string" ||
    workflowRef.length > 512 ||
    !workflowRef.startsWith(`${repository}/.github/workflows/ci.yml@refs/`) ||
    /[\r\n\0]/u.test(workflowRef)
  ) {
    throw new Error("Invalid browser diagnostic identity");
  }
  const number = event === "pull_request" ? Number(env.PR_NUMBER) : null;
  if (
    event === "pull_request" &&
    (!ID.test(env.PR_NUMBER ?? "") ||
      !Number.isSafeInteger(number) ||
      !SHA.test(env.PR_HEAD_SHA ?? "") ||
      !SHA.test(env.PR_BASE_SHA ?? "") ||
      workflowRef !== `${repository}/.github/workflows/ci.yml@refs/pull/${number}/merge`)
  ) {
    throw new Error("Invalid PR browser diagnostic identity");
  }
  directory(join(workspace, ".github"));
  directory(join(workspace, ".github", "workflows"));
  return {
    repository,
    event,
    runId,
    runAttempt,
    job,
    checkoutSha,
    workflowSha: env.GITHUB_WORKFLOW_SHA,
    workflowRef,
    workflowFileSha256: hash(bytes(join(workspace, ".github", "workflows", "ci.yml"), 1024 * 1024)),
    pr: number === null ? null : { number, headSha: env.PR_HEAD_SHA, baseSha: env.PR_BASE_SHA },
  };
}

function identity(workspace, env) {
  if (
    !["desktop-chromium", "mobile-chromium"].includes(env.BROWSER_PROJECT) ||
    !/^[1-4]$/u.test(env.BROWSER_SHARD ?? "") ||
    env.BROWSER_DIAGNOSTIC_CONTEXT !== POLICY
  )
    throw new Error("Invalid browser diagnostic context");
  return {
    ...baseIdentity(workspace, env),
    project: env.BROWSER_PROJECT,
    shard: Number(env.BROWSER_SHARD),
  };
}

function limitsOf(input = LIMITS) {
  const limits = { ...LIMITS, ...input };
  if (
    Object.entries(limits).some(
      ([key, value]) =>
        !Object.hasOwn(LIMITS, key) ||
        !Number.isSafeInteger(value) ||
        value < 1 ||
        value > LIMITS[key],
    )
  )
    throw new Error("Invalid browser diagnostic limits");
  return limits;
}

// Pending bytes and the prepare marker are outside the upload directory.
function publish(staging, name, data) {
  directory(staging);
  directory(join(staging, "artifact"));
  const temporary = join(staging, `.pending-${randomUUID()}`);
  writeFileSync(temporary, data, { flag: "wx", mode: 0o600 });
  directory(staging);
  directory(join(staging, "artifact"));
  linkSync(temporary, join(staging, "artifact", name));
  unlinkSync(temporary);
}

export function prepare(options) {
  const { workspace, staging, env } = roots(options);
  const actual = identity(workspace, env);
  mkdirSync(staging, { mode: 0o700 });
  mkdirSync(join(staging, "artifact"), { mode: 0o700 });
  const marker = { schemaVersion: 1, identity: actual, startedMs: Date.now(), nonce: randomUUID() };
  writeFileSync(join(staging, ".prepare.json"), `${JSON.stringify(marker)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  return marker;
}

function kind(name) {
  if (name === "trace.zip") return "trace";
  if (/^test-failed-[1-9][0-9]*\.png$/u.test(name)) return "screenshot";
  if (name === "error-context.md") return "context";
  return null;
}

function validContent(data, type) {
  if (type === "trace") return data.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]));
  if (type === "screenshot")
    return data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(data);
    return !data.includes(0);
  } catch {
    return false;
  }
}

function checkChain(chain) {
  for (const item of chain) {
    const current = lstatSync(item.path);
    const opened = fstatSync(item.fd);
    if (
      !current.isDirectory() ||
      current.isSymbolicLink() ||
      current.dev !== opened.dev ||
      current.ino !== opened.ino
    )
      throw new Rejected("changed_directory");
  }
}

function attachments(workspace, staging, marker, limits) {
  const files = [];
  const gaps = new Set();
  let total = 0;
  let entries = 0;
  let excluded = 0;
  let halted = false;
  const root = join(workspace, "test-results");
  function visit(path, chain, parts) {
    if (halted) return;
    let fd;
    let stream;
    try {
      if (chain.length) checkChain(chain);
      const parent = chain.at(-1);
      const anchored =
        parent && process.platform === "linux"
          ? `/proc/self/fd/${parent.fd}/${basename(path)}`
          : path;
      fd = openSync(
        anchored,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      const current = [...chain, { path, fd }];
      checkChain(current);
      const listing = process.platform === "linux" ? `/proc/self/fd/${fd}` : path;
      stream = opendirSync(listing, { bufferSize: 1 });
      for (;;) {
        if (halted) break;
        if (entries >= limits.entries) {
          gaps.add("entry_limit");
          halted = true;
          break;
        }
        const entry = stream.readSync();
        if (!entry) break;
        entries++;
        if (entry.isSymbolicLink()) {
          gaps.add("symlink_entry");
          continue;
        }
        if (entry.name.startsWith(".")) {
          excluded++;
          continue;
        }
        const local = [...parts, entry.name].join("/");
        if (local.length > limits.path || !/^[A-Za-z0-9_./-]+$/u.test(local)) {
          gaps.add("unsafe_path");
          continue;
        }
        const child = join(path, entry.name);
        if (entry.isDirectory()) {
          if (parts.length >= limits.depth) gaps.add("depth_limit");
          else visit(child, current, [...parts, entry.name]);
          continue;
        }
        const type = kind(entry.name);
        if (!type || !parts.length) {
          excluded++;
          continue;
        }
        if (files.length >= limits.files) {
          gaps.add("file_count_limit");
          halted = true;
          break;
        }
        const record = {
          sourcePath: `test-results/${local}`,
          type,
          testIdentity: "not-recorded",
          retryIndex: "not-recorded",
        };
        let data;
        try {
          checkChain(current);
          data = bytes(child, limits[type], marker.startedMs, fstatSync(fd));
          checkChain(current);
          if (data.length > limits.total - total) throw new Rejected("total_limit");
          if (!validContent(data, type)) throw new Rejected("invalid_content");
        } catch (error) {
          files.push({
            ...record,
            status: "rejected",
            reason: error instanceof Rejected ? error.reason : "read_failed",
            ...(error instanceof Rejected && error.observedBytes !== undefined
              ? { observedBytes: error.observedBytes }
              : {}),
          });
          continue;
        }
        // Publishing errors are fatal: never signal readiness with an unlisted payload.
        const stagedPath = `${String(files.length).padStart(3, "0")}-${entry.name}`;
        publish(staging, stagedPath, data);
        files.push({
          ...record,
          status: "present",
          stagedPath,
          bytes: data.length,
          sha256: hash(data),
        });
        total += data.length;
      }
      checkChain(current);
    } catch (error) {
      if (error.code === "ENOENT" && !chain.length && fd === undefined) gaps.add("output_absent");
      else throw error;
    } finally {
      if (stream) stream.closeSync();
      if (fd !== undefined) closeSync(fd);
    }
  }
  visit(root, [], []);
  return { files, total, entries, excluded, gaps: [...gaps] };
}

function verifyStaging(staging, files) {
  const path = join(staging, "artifact");
  const parent = directory(path);
  const expected = new Map(
    files.filter((file) => file.status === "present").map((file) => [file.stagedPath, file]),
  );
  const stream = opendirSync(path, { bufferSize: 1 });
  try {
    for (;;) {
      const entry = stream.readSync();
      if (!entry) break;
      const file = expected.get(entry.name);
      if (!file || !entry.isFile()) throw new Error("Unexpected staged browser payload");
      const data = bytes(join(path, entry.name), file.bytes, undefined, parent);
      if (data.length !== file.bytes || hash(data) !== file.sha256)
        throw new Error("Changed staged browser payload");
      expected.delete(entry.name);
    }
    if (expected.size) throw new Error("Missing staged browser payload");
  } finally {
    stream.closeSync();
  }
}

export function collect(options) {
  const { workspace, staging, env } = roots(options);
  directory(staging);
  const limits = limitsOf(options.limits);
  const marker = JSON.parse(
    bytes(join(staging, ".prepare.json"), LIMITS.manifest).toString("utf8"),
  );
  const actual = identity(workspace, env);
  if (
    marker.schemaVersion !== 1 ||
    JSON.stringify(marker.identity) !== JSON.stringify(actual) ||
    !integer(marker.startedMs) ||
    marker.startedMs > Date.now() ||
    !/^[a-f0-9-]{36}$/u.test(marker.nonce ?? "")
  )
    throw new Error("Browser diagnostic marker identity differs");
  const outcome = env.BROWSER_TEST_OUTCOME || "unknown";
  if (!OUTCOMES.has(outcome)) throw new Error("Invalid browser source outcome");
  const result = attachments(workspace, staging, marker, limits);
  verifyStaging(staging, result.files);
  const incomplete =
    result.files.some((file) => file.status === "rejected") ||
    result.gaps.some((gap) => gap !== "output_absent");
  const manifest = {
    schemaVersion: 1,
    identity: actual,
    preparedAt: new Date(marker.startedMs).toISOString(),
    collectedAt: new Date().toISOString(),
    sourceStepOutcome: outcome,
    sourceReceipt:
      actual.event === "pull_request"
        ? {
            expectedArtifact: `source-candidate-${actual.runId}-${actual.runAttempt}`,
            validated: false,
          }
        : { applicable: false, validated: false, reason: "Push has no PR source receipt." },
    privacy: {
      context: POLICY,
      content: "Unsanitized CI fixture diagnostics; may include sessions, DOM, network and source.",
      audience: "Repository Actions artifact readers; not private storage.",
      assurance: "Context declared by reviewed workflow, not content sanitization.",
    },
    files: result.files,
    attachmentBytes: result.total,
    enumeratedEntries: result.entries,
    excludedEntries: result.excluded,
    gaps: result.gaps,
    limits,
    retentionDays: 7,
    diagnostics: incomplete
      ? "incomplete"
      : result.files.some((file) => file.status === "present")
        ? "collected"
        : "absent",
    meaning:
      "Original test step outcome is authoritative. No attachments does not prove a clean first attempt; filenames do not establish test/retry identity or body/cleanup outcomes.",
  };
  const encoded = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  if (encoded.length > limits.manifest) throw new Error("Browser manifest exceeds limit");
  publish(staging, "manifest.json", encoded);
  return { manifest, exitCode: incomplete ? 1 : 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4 || !["prepare", "collect"].includes(process.argv[2]))
      throw new Error("Invalid invocation");
    const options = { workspace: process.cwd(), staging: process.argv[3], env: process.env };
    if (process.argv[2] === "prepare") prepare(options);
    else {
      const result = collect(options);
      if (process.env.GITHUB_OUTPUT)
        appendFileSync(process.env.GITHUB_OUTPUT, "artifact_ready=true\n");
      process.exitCode = result.exitCode;
      if (result.exitCode)
        process.stderr.write("Browser diagnostics incomplete; inspect bounded manifest.\n");
    }
  } catch {
    process.stderr.write("Browser diagnostics failed; no safe upload-ready signal.\n");
    process.exitCode = 1;
  }
}
