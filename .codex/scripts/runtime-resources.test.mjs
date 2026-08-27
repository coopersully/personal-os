import assert from 'node:assert/strict';
import test from 'node:test';

import {
  composeCommand,
  inspectOwnedDockerResources,
  processMatches,
  removeOwnedDockerResources,
  stopOwnedProcessGroup,
} from './runtime-resources.mjs';

const allocation = {
  runtimeId: '123456789abc',
  repositoryId: '0123456789abcdef0123456789abcdef',
  root: '/tmp/ilo-linked',
  rootHash: 'a'.repeat(64),
  composeProject: 'ilo-wt-123456789abc',
  ports: { web: 8086, api: 8793, mcp: 8794, postgres: 55438 },
  processes: {},
};

const processRecord = {
  pid: 4321,
  pgid: 4321,
  startIdentity: 'Mon Aug 24 12:00:00 2026',
  commandMarker: '--runtime-id 123456789abc',
  cwd: allocation.root,
};

test('processMatches requires PID, start identity, runtime marker, and available cwd', () => {
  assert.equal(processMatches(processRecord, {
    pid: processRecord.pid,
    startIdentity: processRecord.startIdentity,
    command: `node runtime-supervisor.mjs ${processRecord.commandMarker}`,
    cwd: allocation.root,
  }), true);
  assert.equal(processMatches(processRecord, {
    pid: processRecord.pid,
    startIdentity: 'different-start',
    command: processRecord.commandMarker,
    cwd: allocation.root,
  }), false);
  assert.equal(processMatches(processRecord, {
    pid: processRecord.pid,
    startIdentity: processRecord.startIdentity,
    command: 'node runtime-supervisor.mjs',
    cwd: allocation.root,
  }), false);
  assert.equal(processMatches(processRecord, {
    pid: processRecord.pid,
    startIdentity: processRecord.startIdentity,
    command: processRecord.commandMarker,
    cwd: '/tmp/other',
  }), false);
  assert.equal(processMatches(processRecord, {
    pid: processRecord.pid,
    startIdentity: processRecord.startIdentity,
    command: processRecord.commandMarker,
    cwd: null,
  }), true);
});

test('composeCommand pins project, file, loopback database port, and ownership variables', () => {
  const command = composeCommand(allocation, allocation.root, ['up', '-d', 'postgres']);
  assert.equal(command.file, 'docker');
  assert.deepEqual(command.args, [
    'compose', '-p', allocation.composeProject,
    '-f', `${allocation.root}/.codex/runtime/compose.yaml`,
    'up', '-d', 'postgres',
  ]);
  assert.deepEqual(command.env, {
    ILO_RUNTIME_ID: allocation.runtimeId,
    ILO_REPOSITORY_ID: allocation.repositoryId,
    ILO_ROOT_HASH: allocation.rootHash,
    LOCAL_POSTGRES_PORT: String(allocation.ports.postgres),
  });
});

function dockerFixture({ mutateLabel = false, missingLabel = false, foreignProject = false, unavailable = false, failRemove = false } = {}) {
  const calls = [];
  const labels = {
    'org.docker.compose.project': allocation.composeProject,
    'app.ilo.runtime.id': allocation.runtimeId,
    'app.ilo.runtime.repository': allocation.repositoryId,
    'app.ilo.runtime.root': allocation.rootHash,
  };
  const resources = {
    container: ['container-1'],
    network: ['network-1'],
    volume: ['volume-1'],
  };
  return {
    calls,
    execFile: async (file, args) => {
      calls.push([file, ...args]);
      if (unavailable) {
        const error = new Error('spawn docker ENOENT');
        error.code = 'ENOENT';
        throw error;
      }
      const type = args[0];
      if (args.includes('ls') || type === 'ps') {
        const key = type === 'ps' ? 'container' : type;
        return { stdout: `${resources[key].join('\n')}\n`, stderr: '' };
      }
      if (type === 'inspect') {
        const id = args.at(-1);
        const inspectedLabels = { ...labels };
        if (mutateLabel && id === 'network-1') {
          inspectedLabels['app.ilo.runtime.root'] = 'b'.repeat(64);
        }
        if (missingLabel && id === 'container-1') {
          delete inspectedLabels['app.ilo.runtime.repository'];
        }
        if (foreignProject && id === 'volume-1') {
          inspectedLabels['org.docker.compose.project'] = 'ilo-wt-foreign';
        }
        return { stdout: `${JSON.stringify([{ Id: id, Name: id, Labels: inspectedLabels }])}\n`, stderr: '' };
      }
      if (args.includes('rm')) {
        if (failRemove && type === 'network') {
          throw new Error('remove failed');
        }
        return { stdout: '', stderr: '' };
      }
      throw new Error(`Unexpected Docker command: ${args.join(' ')}`);
    },
  };
}

test('Docker inspection accepts only resources with complete ownership labels', async () => {
  const fixture = dockerFixture();
  const result = await inspectOwnedDockerResources(allocation, fixture);
  assert.equal(result.ok, true);
  assert.deepEqual(result.resources, {
    containers: ['container-1'],
    networks: ['network-1'],
    volumes: ['volume-1'],
  });
});

test('Docker inspection fails closed when Docker is unavailable or a label differs', async () => {
  assert.equal((await inspectOwnedDockerResources(allocation, dockerFixture({ unavailable: true }))).code, 'docker-unavailable');
  assert.equal((await inspectOwnedDockerResources(allocation, dockerFixture({ mutateLabel: true }))).code, 'docker-label-mismatch');
  assert.equal((await inspectOwnedDockerResources(allocation, dockerFixture({ missingLabel: true }))).code, 'docker-label-mismatch');
  assert.equal((await inspectOwnedDockerResources(allocation, dockerFixture({ foreignProject: true }))).code, 'docker-label-mismatch');
});

test('Docker removal never mutates after mismatch and otherwise removes containers, networks, then volumes', async () => {
  const mismatch = dockerFixture({ mutateLabel: true });
  const mismatchResult = await removeOwnedDockerResources(allocation, mismatch);
  assert.equal(mismatchResult.code, 'docker-label-mismatch');
  assert.equal(mismatch.calls.some((call) => call.includes('rm')), false);

  const fixture = dockerFixture();
  const result = await removeOwnedDockerResources(allocation, fixture);
  assert.equal(result.ok, true);
  const removals = fixture.calls.filter((call) => call.includes('rm'));
  assert.deepEqual(removals.map((call) => call[1]), ['container', 'network', 'volume']);
});

test('Docker removal reports failure without claiming cleanup', async () => {
  const fixture = dockerFixture({ failRemove: true });
  const result = await removeOwnedDockerResources(allocation, fixture);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'docker-remove-failed');
});

test('owned process groups are stopped only after a fresh identity match', async () => {
  const signals = [];
  const owned = {
    ...allocation,
    processes: { supervisor: processRecord },
  };
  const stopped = await stopOwnedProcessGroup(owned, {
    inspectProcess: async () => ({
      pid: processRecord.pid,
      startIdentity: processRecord.startIdentity,
      command: processRecord.commandMarker,
      cwd: allocation.root,
    }),
    kill: (pid, signal) => signals.push([pid, signal]),
  });
  assert.deepEqual(stopped, { ok: true, stopped: true });
  assert.deepEqual(signals, [[-processRecord.pgid, 'SIGTERM']]);

  signals.length = 0;
  const refused = await stopOwnedProcessGroup(owned, {
    inspectProcess: async () => ({
      pid: processRecord.pid,
      startIdentity: 'reused',
      command: processRecord.commandMarker,
      cwd: allocation.root,
    }),
    kill: (pid, signal) => signals.push([pid, signal]),
  });
  assert.equal(refused.code, 'process-identity-mismatch');
  assert.deepEqual(signals, []);
});
