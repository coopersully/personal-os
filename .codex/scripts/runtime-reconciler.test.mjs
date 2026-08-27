import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyAllocation,
  parseWorktreePorcelain,
  reconcileAllocation,
} from './runtime-reconciler.mjs';

const now = new Date('2026-08-27T12:01:00.000Z');
const allocation = {
  schemaVersion: 1,
  runtimeId: '123456789abc',
  repositoryId: '0123456789abcdef0123456789abcdef',
  root: '/tmp/linked',
  rootHash: 'a'.repeat(64),
  gitDir: '/tmp/repo/.git/worktrees/linked',
  tier: 2,
  ports: { web: 8086, api: 8793, mcp: 8794, postgres: 55438 },
  composeProject: 'ilo-wt-123456789abc',
  state: 'allocated',
  createdAt: '2026-08-27T11:00:00.000Z',
  updatedAt: '2026-08-27T11:00:00.000Z',
  orphanedAt: null,
  cleanup: null,
  processes: {},
};

test('parseWorktreePorcelain preserves detached, locked, and prunable records', () => {
  const fixture = [
    'worktree /tmp/primary', 'HEAD abc', 'branch refs/heads/main', '',
    'worktree /tmp/linked', 'HEAD def', 'detached', 'locked user requested', '',
    'worktree /tmp/gone', 'HEAD fed', 'prunable gitdir file points to non-existent location', '',
  ].join('\0');
  assert.deepEqual(parseWorktreePorcelain(Buffer.from(fixture)), [
    { root: '/tmp/primary', head: 'abc', branch: 'refs/heads/main', detached: false, locked: null, prunable: null },
    { root: '/tmp/linked', head: 'def', branch: null, detached: true, locked: 'user requested', prunable: null },
    { root: '/tmp/gone', head: 'fed', branch: null, detached: false, locked: null, prunable: 'gitdir file points to non-existent location' },
  ]);
});

test('classification protects live, present-unregistered, and missing-locked roots', () => {
  const registered = { root: allocation.root, locked: null, prunable: null };
  const locked = { root: allocation.root, locked: 'in use', prunable: null };
  assert.equal(classifyAllocation(allocation, { rootExists: true, worktree: registered }, now).kind, 'live');
  assert.equal(classifyAllocation(allocation, { rootExists: false, worktree: locked }, now).kind, 'drifted-missing-locked');
  assert.equal(classifyAllocation(allocation, { rootExists: true, worktree: null }, now).kind, 'drifted-present-unregistered');
});

test('orphan cleanup requires two observations and at least sixty seconds', () => {
  const missing = { rootExists: false, worktree: null };
  assert.equal(classifyAllocation(allocation, missing, now).kind, 'orphan-pending');
  assert.equal(classifyAllocation({ ...allocation, orphanedAt: '2026-08-27T12:00:01.000Z' }, missing, now).kind, 'orphan-pending');
  assert.equal(classifyAllocation({ ...allocation, orphanedAt: '2026-08-27T12:00:00.000Z' }, missing, now).kind, 'orphan-ready');
  assert.equal(classifyAllocation(allocation, {
    rootExists: false,
    worktree: { root: allocation.root, locked: null, prunable: null },
  }, now).kind, 'orphan-pending');
});

function adapters(overrides = {}) {
  const mutations = [];
  return {
    mutations,
    now: () => now,
    randomUUID: () => '00000000-0000-4000-8000-000000000001',
    currentProcessStart: async () => 'process-start',
    replaceAllocation: async (_context, value) => {
      mutations.push(['replace', structuredClone(value)]);
      return value;
    },
    deleteAllocation: async (_context, runtimeId, options) => {
      mutations.push(['delete', runtimeId, options]);
      return true;
    },
    stopOwnedProcessGroup: async () => ({ ok: true }),
    removeOwnedDockerResources: async () => ({ ok: true }),
    ownerIsLive: async () => false,
    ...overrides,
  };
}

test('first missing observation marks pending and a reappearing root clears it', async () => {
  const first = adapters();
  await reconcileAllocation({}, allocation, {
    ...first,
    snapshot: { rootExists: false, worktree: null },
  });
  assert.equal(first.mutations[0][1].orphanedAt, now.toISOString());

  const recovery = adapters();
  await reconcileAllocation({}, { ...allocation, orphanedAt: now.toISOString() }, {
    ...recovery,
    snapshot: { rootExists: true, worktree: { root: allocation.root } },
  });
  assert.equal(recovery.mutations[0][1].orphanedAt, null);
});

test('dry-run reports an eligible orphan without mutation', async () => {
  const fixture = adapters();
  const result = await reconcileAllocation({}, {
    ...allocation,
    orphanedAt: '2026-08-27T12:00:00.000Z',
  }, {
    ...fixture,
    dryRun: true,
    snapshot: { rootExists: false, worktree: null },
  });
  assert.equal(result.kind, 'orphan-ready');
  assert.equal(result.wouldCleanup, true);
  assert.deepEqual(fixture.mutations, []);
});

test('cleanup claims an operation token and conditionally deletes only after resource success', async () => {
  const fixture = adapters();
  await reconcileAllocation({}, {
    ...allocation,
    orphanedAt: '2026-08-27T12:00:00.000Z',
  }, {
    ...fixture,
    snapshot: { rootExists: false, worktree: null },
  });
  const releasing = fixture.mutations[0][1];
  assert.equal(releasing.state, 'releasing');
  assert.equal(releasing.cleanup.operationToken, '00000000-0000-4000-8000-000000000001');
  assert.deepEqual(fixture.mutations.at(-1), [
    'delete', allocation.runtimeId,
    { operationToken: releasing.cleanup.operationToken },
  ]);
});

test('live cleanup ownership blocks takeover while a dead owner permits it', async () => {
  const releasing = {
    ...allocation,
    state: 'releasing',
    cleanup: {
      operationToken: 'old-token',
      ownerPid: 999,
      ownerStartIdentity: 'old-start',
      startedAt: '2026-08-27T11:59:00.000Z',
    },
  };
  const live = adapters({ ownerIsLive: async () => true });
  assert.equal((await reconcileAllocation({}, releasing, { ...live })).kind, 'releasing');
  assert.deepEqual(live.mutations, []);

  const dead = adapters({ ownerIsLive: async () => false });
  await reconcileAllocation({}, releasing, { ...dead });
  assert.notEqual(dead.mutations[0][1].cleanup.operationToken, 'old-token');
});

test('cleanup failure retains the allocation and reserved tier', async () => {
  const fixture = adapters({ removeOwnedDockerResources: async () => ({ ok: false, code: 'docker-label-mismatch' }) });
  const result = await reconcileAllocation({}, {
    ...allocation,
    orphanedAt: '2026-08-27T12:00:00.000Z',
  }, {
    ...fixture,
    snapshot: { rootExists: false, worktree: null },
  });
  assert.equal(result.kind, 'cleanup-failed');
  assert.equal(fixture.mutations.at(-1)[1].state, 'cleanup-failed');
  assert.equal(fixture.mutations.at(-1)[1].tier, allocation.tier);
  assert.equal(fixture.mutations.some(([action]) => action === 'delete'), false);
});

test('an operation-token mismatch cannot delete a newer allocation', async () => {
  const fixture = adapters({
    deleteAllocation: async (_context, _runtimeId, options) => {
      fixture.mutations.push(['delete-refused', options]);
      return false;
    },
  });
  const result = await reconcileAllocation({}, {
    ...allocation,
    orphanedAt: '2026-08-27T12:00:00.000Z',
  }, {
    ...fixture,
    snapshot: { rootExists: false, worktree: null },
  });
  assert.equal(result.kind, 'cleanup-raced');
  assert.equal(fixture.mutations.some(([action]) => action === 'replace' && action === 'cleanup-failed'), false);
});
