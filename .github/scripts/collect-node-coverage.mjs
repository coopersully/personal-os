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
  openSync,
  readSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const LIMITS = Object.freeze({
  summary: 1024 * 1024,
  detailed: 64 * 1024 * 1024,
  total: 65 * 1024 * 1024,
  manifest: 64 * 1024,
});
const REPORTS = ["coverage-summary.json", "coverage-final.json"];
const SHA = /^[a-f0-9]{40}$/u;
const ID = /^[1-9][0-9]*$/u;
const OUTCOMES = new Set(["success", "failure", "cancelled", "skipped", "unknown"]);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value, allowed) =>
  object(value) && Object.keys(value).every((key) => allowed.includes(key));
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const owns = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

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
    throw new Error("Unsafe coverage directory");
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
  if (dirname(staging) !== runner || staging !== join(runner, "node-coverage")) {
    throw new Error("Unsafe staging directory");
  }
  return { workspace, staging, env };
}

// Open nonblocking before inspecting the descriptor: a FIFO must never hang the job.
function bytes(path, maximum, since) {
  let fd;
  let parentFd;
  try {
    parentFd = openSync(
      dirname(path),
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const parent = fstatSync(parentFd);
    if (!parent.isDirectory()) throw new Rejected("unsafe_directory");
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

function identity(workspace, env) {
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
    throw new Error("Invalid coverage identity");
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
    throw new Error("Invalid PR coverage identity");
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

function limitsOf(input = LIMITS) {
  const limits = { ...LIMITS, ...input };
  if (
    !keys(limits, Object.keys(LIMITS)) ||
    Object.entries(limits).some(
      ([key, value]) => !Number.isSafeInteger(value) || value < 1 || value > LIMITS[key],
    )
  ) {
    throw new Error("Invalid coverage limits");
  }
  return limits;
}

// Publish complete bytes exclusively; a write failure must never expose a truncated upload path.
function publish(staging, name, data) {
  directory(staging);
  const temporary = join(staging, `.pending-${randomUUID()}`);
  writeFileSync(temporary, data, { flag: "wx", mode: 0o600 });
  directory(staging);
  linkSync(temporary, join(staging, name));
  unlinkSync(temporary);
  directory(staging);
}

export function prepare(options) {
  const { workspace, staging, env } = roots(options);
  const actual = identity(workspace, env);
  // An existing directory is never reused, cleaned, or silently rebound to another attempt.
  mkdirSync(staging, { mode: 0o700 });
  const marker = { schemaVersion: 1, identity: actual, startedMs: Date.now(), nonce: randomUUID() };
  writeFileSync(join(staging, ".prepare.json"), `${JSON.stringify(marker)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  return marker;
}

function sourcePath(path, workspace) {
  if (typeof path !== "string" || path.length > 4096 || /[\r\n\0]/u.test(path)) return false;
  const resolved = resolve(workspace, path);
  const local = relative(workspace, resolved);
  if (
    local === "" ||
    isAbsolute(local) ||
    local.split(sep).includes("..") ||
    !(local.startsWith(`apps${sep}`) || local.startsWith(`packages${sep}`))
  )
    return false;
  try {
    return realpathSync(resolved) === resolved && lstatSync(resolved).isFile();
  } catch {
    return false;
  }
}

function point(value) {
  return (
    keys(value, ["line", "column"]) &&
    integer(value.line) &&
    value.line > 0 &&
    integer(value.column)
  );
}

function location(value) {
  return (
    keys(value, ["start", "end", "skip"]) &&
    point(value.start) &&
    point(value.end) &&
    value.end.line >= value.start.line &&
    (value.end.line !== value.start.line || value.end.column >= value.start.column) &&
    (!owns(value, "skip") || typeof value.skip === "boolean")
  );
}

function countMap(map, validate) {
  return (
    object(map) &&
    Object.entries(map).every(([key, value]) => /^\d+$/u.test(key) && validate(value))
  );
}

function sameKeys(a, b) {
  const left = Object.keys(a).sort();
  const right = Object.keys(b).sort();
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

function summary(value, workspace) {
  const fields = ["lines", "statements", "functions", "branches", "branchesTrue"];
  return (
    object(value) &&
    owns(value, "total") &&
    Object.entries(value).every(
      ([path, metrics]) =>
        (path === "total" || sourcePath(path, workspace)) &&
        keys(metrics, fields) &&
        fields.slice(0, 4).every((name) => owns(metrics, name)) &&
        Object.values(metrics).every(
          (metric) =>
            keys(metric, ["total", "covered", "skipped", "pct"]) &&
            integer(metric.total) &&
            integer(metric.covered) &&
            integer(metric.skipped) &&
            metric.covered <= metric.total &&
            metric.skipped <= metric.total &&
            (metric.pct === "Unknown" ||
              (typeof metric.pct === "number" &&
                Number.isFinite(metric.pct) &&
                metric.pct >= 0 &&
                metric.pct <= 100)),
        ),
    )
  );
}

function coverage(value, workspace) {
  return (
    object(value) &&
    Object.entries(value).every(([path, file]) => {
      if (
        !sourcePath(path, workspace) ||
        !keys(file, ["path", "all", "statementMap", "fnMap", "branchMap", "s", "f", "b"]) ||
        file.path !== path ||
        (owns(file, "all") && typeof file.all !== "boolean") ||
        !countMap(file.s, integer) ||
        !countMap(file.f, integer) ||
        !countMap(file.b, (counts) => Array.isArray(counts) && counts.every(integer)) ||
        !countMap(file.statementMap, location) ||
        !countMap(
          file.fnMap,
          (fn) =>
            keys(fn, ["name", "decl", "loc", "line"]) &&
            typeof fn.name === "string" &&
            fn.name.length <= 256 &&
            !/[\r\n\0]/u.test(fn.name) &&
            location(fn.decl) &&
            location(fn.loc) &&
            (!owns(fn, "line") || integer(fn.line)),
        ) ||
        !countMap(
          file.branchMap,
          (branch) =>
            keys(branch, ["type", "line", "loc", "locations"]) &&
            typeof branch.type === "string" &&
            /^[A-Za-z-]{1,64}$/u.test(branch.type) &&
            location(branch.loc) &&
            Array.isArray(branch.locations) &&
            branch.locations.every(location) &&
            (!owns(branch, "line") || integer(branch.line)),
        )
      )
        return false;
      return (
        sameKeys(file.s, file.statementMap) &&
        sameKeys(file.f, file.fnMap) &&
        sameKeys(file.b, file.branchMap) &&
        Object.entries(file.b).every(
          ([key, counts]) => counts.length === file.branchMap[key].locations.length,
        )
      );
    })
  );
}

function report(workspace, name, marker, limits, remaining) {
  try {
    const coverageDirectory = join(workspace, "coverage");
    directory(coverageDirectory);
    const maximum = name === "coverage-summary.json" ? limits.summary : limits.detailed;
    const data = bytes(join(coverageDirectory, name), maximum, marker.startedMs);
    if (data.length > remaining) throw new Rejected("total_limit");
    let value;
    try {
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data));
    } catch {
      throw new Rejected("invalid_json");
    }
    if (!(name === REPORTS[0] ? summary(value, workspace) : coverage(value, workspace))) {
      throw new Rejected("invalid_coverage_shape");
    }
    directory(coverageDirectory);
    return { data, record: { name, status: "present", bytes: data.length, sha256: hash(data) } };
  } catch (error) {
    const reason =
      error instanceof Rejected
        ? error.reason
        : error.code === "ENOENT"
          ? "absent"
          : "unsafe_directory";
    return {
      record: {
        name,
        status: reason === "absent" ? "missing" : "rejected",
        reason,
        ...(reason === "file_limit" && error instanceof Rejected && owns(error, "observedBytes")
          ? { observedBytes: error.observedBytes }
          : {}),
      },
    };
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
    typeof marker.nonce !== "string" ||
    !/^[a-f0-9-]{36}$/u.test(marker.nonce)
  ) {
    throw new Error("Coverage marker identity differs");
  }
  const sourceSteps = Object.fromEntries(
    ["install", "audit", "node"].map((name) => {
      const outcome = env[`${name.toUpperCase()}_OUTCOME`] || "unknown";
      if (!OUTCOMES.has(outcome)) throw new Error("Invalid source step outcome");
      return [name, outcome];
    }),
  );
  const files = [];
  let total = 0;
  for (const name of REPORTS) {
    const { data, record } = report(workspace, name, marker, limits, limits.total - total);
    if (data) {
      publish(staging, name, data);
      total += data.length;
    }
    files.push(record);
  }
  const incomplete =
    files.some((file) => file.status === "rejected") ||
    (sourceSteps.node === "success" && files.some((file) => file.status !== "present"));
  const manifest = {
    schemaVersion: 1,
    identity: actual,
    preparedAt: new Date(marker.startedMs).toISOString(),
    collectedAt: new Date().toISOString(),
    sourceSteps,
    sourceReceipt:
      actual.event === "pull_request"
        ? {
            expectedArtifact: `source-candidate-${actual.runId}-${actual.runAttempt}`,
            validated: false,
            meaning:
              "Correlation reference only; collection does not fetch or validate the source receipt.",
          }
        : {
            applicable: false,
            validated: false,
            reason: "Push workflows do not publish PR source receipts.",
          },
    files,
    reportBytes: total,
    limits,
    retentionDays: 7,
    diagnostics: incomplete
      ? "incomplete"
      : files.every((file) => file.status === "missing")
        ? "absent"
        : "collected",
    meaning:
      "Diagnostics only. Step outcomes are not numeric exits or inferred failure stages; artifacts do not establish source verification success.",
  };
  const encoded = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  if (encoded.length > limits.manifest) throw new Error("Coverage manifest exceeds limits");
  directory(staging);
  publish(staging, "manifest.json", encoded);
  return { manifest, exitCode: incomplete ? 1 : 0 };
}

function main() {
  const options = { workspace: process.cwd(), staging: process.argv[3], env: process.env };
  if (process.argv.length !== 4 || !["prepare", "collect"].includes(process.argv[2])) {
    throw new Error("Expected coverage prepare or collect and a staging directory");
  }
  if (process.argv[2] === "prepare") {
    prepare(options);
    return;
  }
  const result = collect(options);
  // Set only after safe staging succeeds, including a truthful manifest on source failure.
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, "artifact_ready=true\n");
  if (result.exitCode)
    process.stderr.write("Coverage diagnostics incomplete; inspect the bounded manifest.\n");
  process.exitCode = result.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch {
    process.stderr.write(
      "Coverage diagnostic collection failed; no safe upload-ready signal was produced.\n",
    );
    process.exitCode = 1;
  }
}
