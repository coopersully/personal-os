import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { authorizeAdoption, eligibleRelease, healthDecision, tick } from "./continuous.mjs";
import { privateFile, withLock, writePrivate } from "./safety.mjs";

const old = "a".repeat(40),
  candidate = "b".repeat(40);
const image = `sha256:${"c".repeat(64)}`;
const successfulRun = {
  id: 20,
  head_sha: candidate,
  head_branch: "main",
  event: "push",
  path: ".github/workflows/ci.yml",
  status: "completed",
  conclusion: "success",
  head_repository: { full_name: "coopersully/personal-os" },
};

test("only the latest exact-main successful push CI can authorize a descendant release", () => {
  const input = { candidate, deployed: old, descendant: true, runs: [successfulRun] };
  assert.equal(eligibleRelease(input), true);
  for (const change of [
    { head_sha: old },
    { head_branch: "feature" },
    { event: "pull_request" },
    { path: ".github/workflows/other.yml" },
    { status: "in_progress" },
    { conclusion: "failure" },
    { head_repository: { full_name: "stranger/fork" } },
  ])
    assert.equal(eligibleRelease({ ...input, runs: [{ ...successfulRun, ...change }] }), false);
  assert.equal(
    eligibleRelease({
      ...input,
      runs: [successfulRun, { ...successfulRun, id: 21, conclusion: "failure" }],
    }),
    false,
  );
  assert.equal(eligibleRelease({ ...input, descendant: false }), false);
  assert.equal(eligibleRelease({ ...input, deployed: candidate }), false);
  assert.equal(eligibleRelease({ ...input, candidate: "main" }), false);
});

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "nohmi-continuous-test-"));
  const root = join(directory, "nohmi-production");
  mkdirSync(root, { mode: 0o700 });
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const config = {
    version: 1,
    root,
    revision: old,
    postgresMajor: 17,
    backupRecipient: "age1example",
    dockerHost: "unix:///Users/nohmi-production/.colima/nohmi-production/docker.sock",
    images: Object.fromEntries(
      ["api", "mcp", "web", "postgres", "gateway", "tunnel"].map((name) => [name, image]),
    ),
  };
  const configPath = join(root, "config.json");
  writePrivate(configPath, JSON.stringify(config));
  writePrivate(
    join(root, "activation.json"),
    JSON.stringify({ revision: old, localWritesPossibleSince: "2026-09-09" }),
  );
  for (const name of ["api.env", "mcp.env", "postgres.env", "gateway.conf", "tunnel-token"])
    writePrivate(join(root, name), `preserve-${name}`);
  const calls = [];
  const io = {
    load: () => ({ root, config: JSON.parse(privateFile(configPath)) }),
    main: async () => candidate,
    history: async () => true,
    ci: async () => [successfulRun],
    build: async () => {
      calls.push("build");
      return {
        revision: candidate,
        images: { api: `sha256:${"d".repeat(64)}`, mcp: image, web: image },
      };
    },
    check: async () => {},
    stop: async () => {
      calls.push("stop");
    },
    writersStopped: async () => {
      calls.push("drained");
    },
    backup: async () => {
      calls.push("backup");
      return "/private/backup.dump.age";
    },
    start: async () => {
      calls.push("start");
    },
    publish: async () => {
      calls.push("publish");
    },
    containers: async () => [],
    restart: async () => {
      calls.push("restart");
    },
  };
  return {
    root,
    configPath,
    config,
    calls,
    io,
    state: () => JSON.parse(privateFile(join(root, "continuous-state.json"))),
  };
}

test("release switch quiesces writers and preserves all non-application configuration", async (t) => {
  const f = fixture(t);
  await tick(f.configPath, f.io, 1_000_000);
  assert.deepEqual(f.calls, ["build", "stop", "drained", "backup", "start", "publish"]);
  const next = JSON.parse(privateFile(f.configPath));
  assert.equal(next.revision, candidate);
  assert.deepEqual({ ...next, revision: old, images: f.config.images }, f.config);
  for (const name of ["postgres", "gateway", "tunnel"]) assert.equal(next.images[name], image);
  for (const name of ["api.env", "mcp.env", "postgres.env", "gateway.conf", "tunnel-token"])
    assert.equal(readFileSync(join(f.root, name), "utf8"), `preserve-${name}`);
  const activation = JSON.parse(privateFile(join(f.root, "activation.json")));
  assert.equal(activation.localWritesPossibleSince, "2026-09-09");
  assert.equal(activation.revision, candidate);
  assert.equal(f.state().phase, "idle");
  assert.equal(f.state().deployed, candidate);
});

test("failed builds leave the old release running and defer a retry", async (t) => {
  const f = fixture(t);
  f.io.build = async () => {
    throw new Error("secret-canary");
  };
  await tick(f.configPath, f.io, 1_000_000);
  assert.deepEqual(f.calls, []);
  assert.equal(JSON.parse(privateFile(f.configPath)).revision, old);
  assert.equal(f.state().phase, "idle");
  assert.equal(f.state().error, "prepare-failed");
  assert.ok(f.state().nextPollAt > 1_000_000);
  assert.ok(!privateFile(join(f.root, "continuous-state.json")).includes("secret-canary"));
});

test("stale main or maintenance arriving during build prevents the switch", async (t) => {
  for (const maintenance of [false, true]) {
    const f = fixture(t);
    let reads = 0;
    f.io.main = async () => (++reads === 1 || maintenance ? candidate : "e".repeat(40));
    if (maintenance)
      f.io.build = async () => {
        writePrivate(join(f.root, "maintenance.json"), "{}");
        return { revision: candidate, images: { api: image, mcp: image, web: image } };
      };
    await tick(f.configPath, f.io, 1_000_000);
    assert.ok(!f.calls.includes("stop"));
    assert.equal(JSON.parse(privateFile(f.configPath)).revision, old);
  }
});

test("a failed migration blocks every subsequent automatic action without rollback", async (t) => {
  const f = fixture(t);
  f.io.start = async () => {
    throw new Error("migration failed");
  };
  await tick(f.configPath, f.io, 1_000_000);
  assert.equal(f.state().phase, "blocked");
  assert.equal(f.state().deployed, old);
  assert.equal(JSON.parse(privateFile(f.configPath)).revision, candidate);
  assert.equal(f.calls.filter((call) => call === "stop").length, 2);
  const calls = [...f.calls];
  await tick(f.configPath, f.io, 9_000_000);
  assert.deepEqual(f.calls, calls);
  assert.ok(!f.calls.includes("publish"));
});

test("interrupted quiesce and torn config switches require attended reconciliation", async (t) => {
  const f = fixture(t);
  writePrivate(
    join(f.root, "continuous-state.json"),
    JSON.stringify({ version: 1, phase: "switching", deployed: old, candidate }),
  );
  await tick(f.configPath, f.io, 1_000_000);
  assert.deepEqual(f.calls, []);
  assert.equal(f.state().phase, "blocked");
});

test("maintenance and an orphan operation lock exclude both deployment and watchdog", async (t) => {
  const f = fixture(t);
  writePrivate(join(f.root, "maintenance.json"), "{}");
  await tick(f.configPath, f.io, 1_000_000);
  assert.deepEqual(f.calls, []);
  rmSync(join(f.root, "maintenance.json"));
  mkdirSync(join(f.root, "operation.lock"));
  await assert.rejects(tick(f.configPath, f.io, 1_000_000), /locked/);
  assert.deepEqual(f.calls, []);
  assert.ok(existsSync(join(f.root, "operation.lock")));
});

test("concurrent controller ticks cannot build or switch concurrently", async (t) => {
  const f = fixture(t);
  await withLock(f.root, async () => {
    await assert.rejects(tick(f.configPath, f.io, 1_000_000), /locked/);
  });
  assert.deepEqual(f.calls, []);
});

function unhealthy(id = "f".repeat(64)) {
  return {
    Id: id,
    Config: {
      Labels: {
        "com.docker.compose.project": "nohmi-production",
        "com.docker.compose.project.working_dir": "/private/nohmi-production",
        "com.docker.compose.service": "api",
      },
    },
    State: { Running: true, Health: { Status: "unhealthy" } },
  };
}

test("health recovery requires repeated owned running unhealthy observations and is bounded", () => {
  const root = "/private/nohmi-production",
    row = unhealthy();
  let result = healthDecision({}, [row], root, 1_000_000);
  assert.deepEqual(result.restart, []);
  result = healthDecision(result.health, [row], root, 1_060_000);
  assert.deepEqual(result.restart, []);
  result = healthDecision(result.health, [row], root, 1_120_000);
  assert.deepEqual(result.restart, [row.Id]);
  for (let i = 1; i <= 5; i++) {
    result = healthDecision(result.health, [row], root, 1_120_000 + i * 60_000);
    assert.deepEqual(result.restart, []);
  }
  for (let minute = 6; minute <= 35; minute++)
    result = healthDecision(result.health, [row], root, 1_120_000 + minute * 60_000);
  assert.equal(result.health[row.Id].attempts.length, 3);
  assert.deepEqual(result.restart, []);
});

test("watchdog never restarts stopped, foreign, healthy or non-API/MCP containers", () => {
  for (const mutate of [
    (row) => {
      row.State.Running = false;
    },
    (row) => {
      row.State.Health.Status = "healthy";
    },
    (row) => {
      row.Config.Labels["com.docker.compose.project"] = "halara";
    },
    (row) => {
      row.Config.Labels["com.docker.compose.project.working_dir"] = "/elsewhere";
    },
    (row) => {
      row.Config.Labels["com.docker.compose.service"] = "postgres";
    },
    (row) => {
      row.Id = "invalid";
    },
  ]) {
    const row = unhealthy();
    mutate(row);
    const result = healthDecision(
      { [row.Id]: { observations: 10, attempts: [] } },
      [row],
      "/private/nohmi-production",
      1_000_000,
    );
    assert.deepEqual(result.restart, []);
  }
});

test("GitHub failures cannot stop the live application and idle polling avoids request bursts", async (t) => {
  const f = fixture(t);
  let requests = 0;
  f.io.ci = async () => {
    requests++;
    throw new Error("network");
  };
  await tick(f.configPath, f.io, 1_000_000);
  await tick(f.configPath, f.io, 1_060_000);
  assert.equal(requests, 1);
  assert.deepEqual(f.calls, []);
});

test("a lost restart response consumes its persisted retry budget", async (t) => {
  const f = fixture(t);
  const row = unhealthy();
  row.Config.Labels["com.docker.compose.project.working_dir"] = f.root;
  f.io.containers = async () => [row];
  f.io.main = async () => old;
  let restarts = 0;
  f.io.restart = async () => {
    restarts++;
    throw new Error("lost response");
  };
  for (let minute = 0; minute < 35; minute++)
    await tick(f.configPath, f.io, 1_000_000 + minute * 60_000);
  assert.equal(restarts, 3);
  assert.equal(f.state().health[row.Id].attempts.length, 3);
});

test("rapid manual ticks cannot count as consecutive minute health observations", async (t) => {
  const f = fixture(t);
  const row = unhealthy();
  row.Config.Labels["com.docker.compose.project.working_dir"] = f.root;
  f.io.containers = async () => [row];
  f.io.main = async () => old;
  for (let i = 0; i < 5; i++) await tick(f.configPath, f.io, 1_000_000 + i);
  assert.ok(!f.calls.includes("restart"));
});

test("a main change during backup safely resumes the untouched old release", async (t) => {
  const f = fixture(t);
  let reads = 0;
  f.io.main = async () => (++reads <= 2 ? candidate : "e".repeat(40));
  await tick(f.configPath, f.io, 1_000_000);
  assert.deepEqual(f.calls, ["build", "stop", "drained", "backup", "start", "publish"]);
  assert.equal(JSON.parse(privateFile(f.configPath)).revision, old);
  assert.equal(f.state().phase, "idle");
  assert.equal(f.state().deployed, old);
});

test("maintenance during backup keeps the untouched old release intentionally stopped", async (t) => {
  const f = fixture(t);
  f.io.backup = async () => {
    writePrivate(join(f.root, "maintenance.json"), "{}");
    return "/private/backup.age";
  };
  await tick(f.configPath, f.io, 1_000_000);
  assert.ok(!f.calls.includes("start"));
  assert.ok(!f.calls.includes("publish"));
  assert.equal(JSON.parse(privateFile(f.configPath)).revision, old);
  assert.equal(f.state().phase, "idle");
});

test("attended squash adoption permits only one exact reviewed main SHA and retains truthful deployment state", async (t) => {
  const f = fixture(t);
  f.io.history = async () => false;
  await authorizeAdoption(f.configPath, f.io, old, candidate, "--attended-bootstrap");
  assert.equal(f.state().deployed, old);
  assert.deepEqual(f.state().adoption, { expectedDeployed: old, target: candidate });
  await tick(f.configPath, f.io, 1_000_000);
  assert.equal(f.state().deployed, candidate);
  assert.equal(f.state().adoption, undefined);
  assert.equal(f.state().bootstrapConsumed, true);
  await assert.rejects(
    authorizeAdoption(f.configPath, f.io, candidate, "e".repeat(40), "--attended-bootstrap"),
  );
});

test("adoption cannot authorize a different candidate, existing ancestor, stale release or missing owner acknowledgement", async (t) => {
  for (const invalid of ["ancestor", "ack", "deployed", "target"]) {
    const f = fixture(t);
    f.io.history = async () => invalid === "ancestor";
    await assert.rejects(
      authorizeAdoption(
        f.configPath,
        f.io,
        invalid === "deployed" ? "c".repeat(40) : old,
        invalid === "target" ? "c".repeat(40) : candidate,
        invalid === "ack" ? "" : "--attended-bootstrap",
      ),
    );
    assert.deepEqual(f.calls, []);
  }
  const f = fixture(t);
  f.io.history = async () => false;
  await authorizeAdoption(f.configPath, f.io, old, candidate, "--attended-bootstrap");
  f.io.main = async () => "c".repeat(40);
  await tick(f.configPath, f.io, 1_000_000);
  assert.deepEqual(f.calls, []);
  assert.equal(f.state().deployed, old);
});
