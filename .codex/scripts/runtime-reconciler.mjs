import { execFile as execFileCallback } from "node:child_process";
import { randomUUID as nodeRandomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";

import {
  deleteAllocation as registryDeleteAllocation,
  listAllocations,
  replaceAllocation as registryReplaceAllocation,
} from "./runtime-registry.mjs";
import {
  inspectProcess,
  removeOwnedDockerResources as removeDocker,
  stopOwnedProcessGroup as stopProcessGroup,
} from "./runtime-resources.mjs";

const execFile = promisify(execFileCallback);

export function parseWorktreePorcelain(buffer) {
  const records = [];
  let current = null;
  for (const field of Buffer.from(buffer).toString("utf8").split("\0")) {
    if (!field) {
      if (current) {
        records.push(current);
        current = null;
      }
      continue;
    }
    const separator = field.indexOf(" ");
    const key = separator === -1 ? field : field.slice(0, separator);
    const value = separator === -1 ? "" : field.slice(separator + 1);
    if (key === "worktree") {
      if (current) {
        records.push(current);
      }
      current = {
        root: value,
        head: null,
        branch: null,
        detached: false,
        locked: null,
        prunable: null,
      };
    } else if (current && key === "HEAD") {
      current.head = value;
    } else if (current && key === "branch") {
      current.branch = value;
    } else if (current && key === "detached") {
      current.detached = true;
    } else if (current && key === "locked") {
      current.locked = value || true;
    } else if (current && key === "prunable") {
      current.prunable = value || true;
    }
  }
  if (current) {
    records.push(current);
  }
  return records;
}

export function classifyAllocation(allocation, snapshot, now = new Date()) {
  if (allocation.state === "releasing") {
    return { kind: "releasing" };
  }
  if (allocation.state === "cleanup-failed") {
    return { kind: "cleanup-failed" };
  }
  if (snapshot.rootExists && snapshot.worktree) {
    return { kind: "live", clearOrphan: Boolean(allocation.orphanedAt) };
  }
  if (snapshot.rootExists && !snapshot.worktree) {
    return { kind: "drifted-present-unregistered" };
  }
  if (snapshot.worktree?.locked) {
    return { kind: "drifted-missing-locked" };
  }
  if (snapshot.worktree && !snapshot.worktree.prunable) {
    return { kind: "orphan-pending", waitingForGit: true };
  }
  if (!allocation.orphanedAt) {
    return { kind: "orphan-pending", elapsedMs: 0, firstObservation: true };
  }
  const elapsedMs = Math.max(0, now.getTime() - new Date(allocation.orphanedAt).getTime());
  if (elapsedMs < 60_000) {
    return { kind: "orphan-pending", elapsedMs, firstObservation: false };
  }
  return { kind: "orphan-ready", elapsedMs };
}

async function defaultCurrentProcessStart() {
  return (await inspectProcess(process.pid))?.startIdentity ?? "unknown";
}

async function defaultOwnerIsLive(cleanup) {
  const observed = await inspectProcess(cleanup.ownerPid);
  return Boolean(observed && observed.startIdentity === cleanup.ownerStartIdentity);
}

function updatedAllocation(allocation, fields, now) {
  return { ...allocation, ...fields, updatedAt: now.toISOString() };
}

async function recordCleanupFailure(context, claimed, code, replaceAllocation, now) {
  const failed = updatedAllocation(
    claimed,
    {
      state: "cleanup-failed",
      cleanup: { ...claimed.cleanup, errorCode: code },
    },
    now,
  );
  const replaced = await replaceAllocation(context, failed, {
    expectedState: "releasing",
    expectedOperationToken: claimed.cleanup.operationToken,
  });
  if (replaced === false) {
    return { kind: "cleanup-raced" };
  }
  return { kind: "cleanup-failed", code, allocation: failed };
}

export async function reconcileAllocation(context, allocation, options = {}) {
  const now = options.now?.() ?? new Date();
  const replaceAllocation = options.replaceAllocation ?? registryReplaceAllocation;
  const deleteAllocation = options.deleteAllocation ?? registryDeleteAllocation;
  const stopOwnedProcessGroup = options.stopOwnedProcessGroup ?? stopProcessGroup;
  const removeOwnedDockerResources = options.removeOwnedDockerResources ?? removeDocker;
  const ownerIsLive = options.ownerIsLive ?? defaultOwnerIsLive;

  let classification;
  if (allocation.state === "releasing" || allocation.state === "cleanup-failed") {
    classification = { kind: allocation.state };
  } else {
    classification = classifyAllocation(allocation, options.snapshot, now);
  }

  if (options.dryRun) {
    return {
      ...classification,
      wouldCleanup: ["orphan-ready", "cleanup-failed"].includes(classification.kind),
    };
  }

  if (classification.kind === "live" && allocation.orphanedAt) {
    const recovered = updatedAllocation(
      allocation,
      {
        state: "allocated",
        orphanedAt: null,
        cleanup: null,
      },
      now,
    );
    const replaced = await replaceAllocation(context, recovered, {
      expectedState: allocation.state,
      expectedOperationToken: allocation.cleanup?.operationToken ?? null,
    });
    if (replaced === false) {
      return { kind: "reconcile-raced" };
    }
    return { kind: "live", allocation: recovered };
  }

  if (classification.kind === "orphan-pending" && classification.firstObservation) {
    const pending = updatedAllocation(
      allocation,
      {
        state: "orphan-pending",
        orphanedAt: now.toISOString(),
      },
      now,
    );
    const replaced = await replaceAllocation(context, pending, {
      expectedState: allocation.state,
      expectedOperationToken: allocation.cleanup?.operationToken ?? null,
    });
    if (replaced === false) {
      return { kind: "reconcile-raced" };
    }
    return { ...classification, allocation: pending };
  }

  if (!["orphan-ready", "releasing", "cleanup-failed"].includes(classification.kind)) {
    return classification;
  }

  if (allocation.cleanup && (await ownerIsLive(allocation.cleanup))) {
    return classification;
  }

  const operationToken = (options.randomUUID ?? nodeRandomUUID)();
  const cleanup = {
    operationToken,
    ownerPid: process.pid,
    ownerStartIdentity: await (options.currentProcessStart ?? defaultCurrentProcessStart)(),
    startedAt: now.toISOString(),
  };
  const claimed = updatedAllocation(allocation, { state: "releasing", cleanup }, now);
  const claimResult = await replaceAllocation(context, claimed, {
    expectedState: allocation.state,
    expectedOperationToken: allocation.cleanup?.operationToken ?? null,
  });
  if (claimResult === false) {
    return { kind: "cleanup-raced" };
  }

  const processResult = await stopOwnedProcessGroup(claimed, options);
  if (!processResult.ok) {
    return recordCleanupFailure(context, claimed, processResult.code, replaceAllocation, now);
  }
  const dockerResult = await removeOwnedDockerResources(claimed, options);
  if (!dockerResult.ok) {
    return recordCleanupFailure(context, claimed, dockerResult.code, replaceAllocation, now);
  }
  const deleted = await deleteAllocation(context, claimed.runtimeId, { operationToken });
  if (!deleted) {
    return { kind: "cleanup-raced" };
  }
  return { kind: "cleaned", runtimeId: claimed.runtimeId, tier: claimed.tier };
}

async function rootExists(root) {
  try {
    await stat(root);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function worktreeSnapshot(context, options) {
  const run = options.execFile ?? execFile;
  const result = await run("git", [
    "--git-dir",
    context.gitCommonDir,
    "worktree",
    "list",
    "--porcelain",
    "-z",
    "--expire",
    "now",
  ]);
  return parseWorktreePorcelain(result.stdout);
}

export async function reconcileRegistry(context, options = {}) {
  const [allocations, worktrees] = await Promise.all([
    listAllocations(context),
    options.worktrees ?? worktreeSnapshot(context, options),
  ]);
  const reports = [];
  for (const allocation of allocations) {
    const snapshot = options.snapshots?.get(allocation.root) ?? {
      rootExists: await rootExists(allocation.root),
      worktree: worktrees.find((candidate) => candidate.root === allocation.root) ?? null,
    };
    reports.push(await reconcileAllocation(context, allocation, { ...options, snapshot }));
  }
  return reports;
}
