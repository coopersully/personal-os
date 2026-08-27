import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  SCHEMA_VERSION,
  UnsupportedRegistrySchemaError,
  acquireAllocation,
  appendAuditEvent,
  deleteAllocation,
  getAllocationForRoot,
  listAllocations,
  migrateLegacyTiers,
  portsForSlot,
  replaceAllocation,
  resolveRepositoryContext,
  withRegistryLock,
} from "./runtime-registry.mjs";

const execFileAsync = promisify(execFile);

async function git(cwd, ...args) {
  return execFileAsync("git", args, { cwd });
}

async function createRepository(t, linkedNames = ["a", "b"]) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ilo-registry-test-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const primary = path.join(temporaryRoot, "repo");
  await mkdir(primary);
  await git(primary, "init", "-q");
  await git(primary, "config", "user.email", "test@example.com");
  await git(primary, "config", "user.name", "Runtime Registry Test");
  await writeFile(path.join(primary, "tracked.txt"), "initial\n");
  await git(primary, "add", "tracked.txt");
  await git(primary, "commit", "-qm", "initial");

  const linked = {};
  for (const name of linkedNames) {
    const root = path.join(temporaryRoot, `worktree-${name}`);
    await git(primary, "worktree", "add", "-q", "--detach", root, "HEAD");
    linked[name] = await realpath(root);
  }

  return {
    primary: await realpath(primary),
    linked,
  };
}

function deterministicOptions(seed = 1, unavailablePorts = new Set()) {
  let next = seed;
  return {
    now: () => new Date("2026-08-27T12:00:00.000Z"),
    probePort: async (port) => !unavailablePorts.has(port),
    randomBytes: (size) => {
      const buffer = Buffer.alloc(size, next);
      next += 1;
      return buffer;
    },
  };
}

test("portsForSlot derives the documented boundary tiers and rejects out-of-range input", () => {
  assert.deepEqual(portsForSlot(1), {
    web: 8081,
    api: 8788,
    mcp: 8789,
    postgres: 55433,
  });
  assert.deepEqual(portsForSlot(16), {
    web: 8156,
    api: 8863,
    mcp: 8864,
    postgres: 55508,
  });
  assert.throws(() => portsForSlot(0), /between 1 and 16/i);
  assert.throws(() => portsForSlot(17), /between 1 and 16/i);
  assert.throws(() => portsForSlot(2.5), /between 1 and 16/i);
});

test("acquireAllocation assigns primary tier 1 and stable lowest-free linked tiers", async (t) => {
  const repository = await createRepository(t);
  const primaryContext = await resolveRepositoryContext(repository.primary);
  const contextA = await resolveRepositoryContext(repository.linked.a);
  const contextB = await resolveRepositoryContext(repository.linked.b);
  const options = deterministicOptions();

  const primary = await acquireAllocation(primaryContext, options);
  const first = await acquireAllocation(contextA, options);
  const second = await acquireAllocation(contextA, options);
  const third = await acquireAllocation(contextB, options);

  assert.equal(primary.tier, 1);
  assert.equal(first.tier, 2);
  assert.equal(first.runtimeId, second.runtimeId);
  assert.equal(third.tier, 3);
  assert.notEqual(first.runtimeId, third.runtimeId);
  assert.equal(first.composeProject, `ilo-wt-${first.runtimeId}`);
  assert.deepEqual(first.ports, {
    web: 8086,
    api: 8793,
    mcp: 8794,
    postgres: 55438,
  });
});

test("acquireAllocation skips a linked tier when any port is occupied", async (t) => {
  const repository = await createRepository(t, ["a"]);
  const context = await resolveRepositoryContext(repository.linked.a);
  const unavailablePorts = new Set([8793]);

  const allocation = await acquireAllocation(context, deterministicOptions(1, unavailablePorts));

  assert.equal(allocation.tier, 3);
  assert.equal(allocation.ports.api, 8798);
});

test("parallel acquisitions serialize and never return the same linked tier", async (t) => {
  const repository = await createRepository(t);
  const contextA = await resolveRepositoryContext(repository.linked.a);
  const contextB = await resolveRepositoryContext(repository.linked.b);

  const [allocationA, allocationB] = await Promise.all([
    acquireAllocation(contextA, deterministicOptions(1)),
    acquireAllocation(contextB, deterministicOptions(20)),
  ]);

  assert.notEqual(allocationA.tier, allocationB.tier);
  assert.notEqual(allocationA.runtimeId, allocationB.runtimeId);
});

test("withRegistryLock reports a live owner instead of stealing its lock", async (t) => {
  const repository = await createRepository(t, []);
  const context = await resolveRepositoryContext(repository.primary);
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const owner = withRegistryLock(context, async () => held);

  await new Promise((resolve) => setTimeout(resolve, 25));
  await assert.rejects(
    () => withRegistryLock(context, async () => undefined, { timeoutMs: 75, retryMs: 10 }),
    /registry lock is held by live pid/i,
  );
  release();
  await owner;
});

test("withRegistryLock recovers a stale lock whose owner identity is dead", async (t) => {
  const repository = await createRepository(t, []);
  const context = await resolveRepositoryContext(repository.primary);
  const lockDirectory = path.join(context.registryDir, "lock");
  await mkdir(lockDirectory);
  await writeFile(
    path.join(lockDirectory, "owner.json"),
    JSON.stringify({
      pid: 999999,
      startIdentity: "missing-process",
      createdAt: "2026-08-27T11:00:00.000Z",
    }),
  );

  const result = await withRegistryLock(context, async () => "recovered", {
    timeoutMs: 100,
    retryMs: 5,
  });

  assert.equal(result, "recovered");
  await assert.rejects(() => stat(lockDirectory));
});

test("acquireAllocation reports exhaustion when all linked tiers are reserved", async (t) => {
  const repository = await createRepository(t);
  const contextA = await resolveRepositoryContext(repository.linked.a);
  const contextB = await resolveRepositoryContext(repository.linked.b);
  const options = deterministicOptions();
  const first = await acquireAllocation(contextA, options);

  for (let tier = 3; tier <= 16; tier += 1) {
    const runtimeId = tier.toString(16).padStart(12, "0");
    await replaceAllocation(contextA, {
      ...first,
      runtimeId,
      root: `/tmp/ilo-reserved-${tier}`,
      rootHash: tier.toString(16).padStart(64, "0"),
      tier,
      ports: portsForSlot(tier),
      composeProject: `ilo-wt-${runtimeId}`,
    });
  }

  await assert.rejects(
    () => acquireAllocation(contextB, options),
    /no linked runtime tiers are available/i,
  );
});

test("newer allocation schemas fail closed without quarantine or rewrite", async (t) => {
  const repository = await createRepository(t, []);
  const context = await resolveRepositoryContext(repository.primary);
  const allocationDirectory = path.join(context.registryDir, "allocations");
  await mkdir(allocationDirectory, { recursive: true });
  const recordPath = path.join(allocationDirectory, "future.json");
  await writeFile(recordPath, JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1 }));

  await assert.rejects(() => listAllocations(context), UnsupportedRegistrySchemaError);
  assert.equal((await stat(recordPath)).isFile(), true);
  await assert.rejects(() => stat(path.join(context.registryDir, "quarantine")));
});

test("malformed records are quarantined and a valid reverse index remains readable", async (t) => {
  const repository = await createRepository(t, ["a"]);
  const context = await resolveRepositoryContext(repository.linked.a);
  const allocation = await acquireAllocation(context, deterministicOptions());
  const malformedPath = path.join(context.registryDir, "allocations", "malformed.json");
  await writeFile(malformedPath, "{not-json");

  const records = await listAllocations(context);
  const recovered = await getAllocationForRoot(context, repository.linked.a);
  const quarantined = await readFile(
    path.join(context.registryDir, "quarantine", "malformed.json.quarantined"),
    "utf8",
  );

  assert.deepEqual(
    records.map((record) => record.runtimeId),
    [allocation.runtimeId],
  );
  assert.equal(recovered.runtimeId, allocation.runtimeId);
  assert.equal(quarantined, "{not-json");
});

test("legacy tier migration imports live roots and leaves stale roots unallocated", async (t) => {
  const repository = await createRepository(t, ["a"]);
  const context = await resolveRepositoryContext(repository.primary);
  const tiers = path.join(context.registryDir, "tiers");
  await mkdir(tiers, { recursive: true });
  await writeFile(path.join(tiers, "2"), `${repository.linked.a}\n`);
  await writeFile(
    path.join(tiers, "3"),
    `${path.join(path.dirname(repository.primary), "missing")}\n`,
  );

  const result = await migrateLegacyTiers(context, deterministicOptions());
  const imported = await getAllocationForRoot(context, repository.linked.a);

  assert.deepEqual(result, { imported: 1, stale: 1 });
  assert.equal(imported.tier, 2);
  assert.equal((await stat(path.join(context.registryDir, "tiers.migrated"))).isDirectory(), true);
});

test("audit events rotate at one MiB and retain the newest event", async (t) => {
  const repository = await createRepository(t, []);
  const context = await resolveRepositoryContext(repository.primary);
  await writeFile(path.join(context.registryDir, "audit.ndjson"), "x".repeat(1024 * 1024));

  await appendAuditEvent(
    context,
    {
      action: "allocated",
      runtimeId: "010101010101",
      tier: 1,
      state: "allocated",
    },
    deterministicOptions(),
  );

  const current = await readFile(path.join(context.registryDir, "audit.ndjson"), "utf8");
  assert.match(current, /"action":"allocated"/);
  assert.equal((await stat(path.join(context.registryDir, "audit.ndjson.1"))).isFile(), true);
});

test("replaceAllocation rejects a tier collision and preserves the first record", async (t) => {
  const repository = await createRepository(t);
  const contextA = await resolveRepositoryContext(repository.linked.a);
  const contextB = await resolveRepositoryContext(repository.linked.b);
  const allocationA = await acquireAllocation(contextA, deterministicOptions());
  const allocationB = {
    ...allocationA,
    composeProject: "ilo-wt-f0f0f0f0f0f0",
    runtimeId: "f0f0f0f0f0f0",
    root: repository.linked.b,
    rootHash: contextB.rootHash,
    gitDir: contextB.gitDir,
  };

  await assert.rejects(() => replaceAllocation(contextB, allocationB), /tier 2 is already owned/i);
  assert.equal(
    (await getAllocationForRoot(contextA, repository.linked.a)).runtimeId,
    allocationA.runtimeId,
  );
});

test("deleteAllocation refuses an operation-token mismatch", async (t) => {
  const repository = await createRepository(t);
  const context = await resolveRepositoryContext(repository.linked.a);
  const allocation = await acquireAllocation(context, deterministicOptions());
  await replaceAllocation(context, {
    ...allocation,
    state: "releasing",
    cleanup: { operationToken: "current-token" },
  });

  assert.equal(
    await deleteAllocation(context, allocation.runtimeId, {
      operationToken: "stale-token",
    }),
    false,
  );
  assert.equal((await getAllocationForRoot(context)).cleanup.operationToken, "current-token");
});

test("replaceAllocation compare-and-swap refuses stale state and cleanup tokens", async (t) => {
  const repository = await createRepository(t);
  const context = await resolveRepositoryContext(repository.linked.a);
  const allocation = await acquireAllocation(context, deterministicOptions());
  const claimed = {
    ...allocation,
    state: "releasing",
    cleanup: { operationToken: "winning-token" },
  };
  assert.notEqual(
    await replaceAllocation(context, claimed, {
      expectedState: "allocated",
      expectedOperationToken: null,
    }),
    false,
  );

  assert.equal(
    await replaceAllocation(
      context,
      {
        ...claimed,
        cleanup: { operationToken: "stale-token" },
      },
      {
        expectedState: "allocated",
        expectedOperationToken: null,
      },
    ),
    false,
  );
  assert.equal((await getAllocationForRoot(context)).cleanup.operationToken, "winning-token");
});

test("linked allocations honor a requested free tier and reject conflicts", async (t) => {
  const repository = await createRepository(t);
  const contextA = await resolveRepositoryContext(repository.linked.a);
  const contextB = await resolveRepositoryContext(repository.linked.b);
  const requested = await acquireAllocation(contextA, {
    ...deterministicOptions(),
    requestedTier: 5,
  });
  assert.equal(requested.tier, 5);
  await assert.rejects(
    () => acquireAllocation(contextB, { ...deterministicOptions(), requestedTier: 5 }),
    /tier 5 is already owned/i,
  );
});
