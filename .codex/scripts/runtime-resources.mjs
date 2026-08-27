import { execFile as execFileCallback } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

function normalizeCommandResult(result) {
  if (typeof result === 'string') {
    return { stdout: result, stderr: '' };
  }
  return { stdout: result?.stdout ?? '', stderr: result?.stderr ?? '' };
}

export async function probePort(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Port must be an integer between 1 and 65535.');
  }
  const server = net.createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen({ host: '127.0.0.1', port, exclusive: true }, resolve);
    });
    return { available: true, port };
  } catch (error) {
    if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
      return { available: false, port, code: error.code };
    }
    throw error;
  } finally {
    if (server.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
  }
}

export async function inspectListener(port, adapters = {}) {
  const run = adapters.execFile ?? execFile;
  try {
    const result = normalizeCommandResult(await run('lsof', [
      '-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpctn',
    ]));
    return { available: true, output: result.stdout, port };
  } catch (error) {
    if (error.code === 1 || error.code === 'ENOENT') {
      return { available: false, output: '', port };
    }
    return { available: false, error: error.message, output: error.stdout ?? '', port };
  }
}

function parseLsofCwd(output) {
  const line = String(output).split(/\r?\n/).find((entry) => entry.startsWith('n'));
  return line ? line.slice(1) : null;
}

export async function inspectProcess(pid, adapters = {}) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return null;
  }
  const run = adapters.execFile ?? execFile;
  try {
    const [start, command] = await Promise.all([
      run('ps', ['-p', String(pid), '-o', 'lstart=']),
      run('ps', ['-p', String(pid), '-o', 'command=']),
    ]);
    let cwd = null;
    try {
      const cwdResult = normalizeCommandResult(await run('lsof', [
        '-a', '-p', String(pid), '-d', 'cwd', '-Fn',
      ]));
      cwd = parseLsofCwd(cwdResult.stdout);
      if (cwd) {
        cwd = await realpath(cwd).catch(() => null);
      }
    } catch {
      cwd = null;
    }
    return {
      pid,
      startIdentity: normalizeCommandResult(start).stdout.trim().replace(/\s+/g, ' '),
      command: normalizeCommandResult(command).stdout.trim(),
      cwd,
    };
  } catch (error) {
    if (error.code === 1 || error.code === 'ESRCH') {
      return null;
    }
    throw error;
  }
}

export function processMatches(record, observed) {
  if (!record || !observed) {
    return false;
  }
  if (record.pid !== observed.pid || record.startIdentity !== observed.startIdentity) {
    return false;
  }
  if (typeof record.commandMarker !== 'string' || !observed.command?.includes(record.commandMarker)) {
    return false;
  }
  if (observed.cwd && record.cwd !== observed.cwd) {
    return false;
  }
  return true;
}

export async function stopOwnedProcessGroup(allocation, adapters = {}) {
  const record = allocation.processes?.supervisor;
  if (!record) {
    return { ok: true, stopped: false };
  }
  const inspect = adapters.inspectProcess ?? ((pid) => inspectProcess(pid, adapters));
  const observed = await inspect(record.pid);
  if (!observed) {
    return { ok: true, stopped: false };
  }
  if (!processMatches(record, observed)) {
    return { ok: false, code: 'process-identity-mismatch' };
  }
  if (!Number.isInteger(record.pgid) || record.pgid <= 0) {
    return { ok: false, code: 'process-group-invalid' };
  }
  try {
    (adapters.kill ?? process.kill)(-record.pgid, adapters.signal ?? 'SIGTERM');
    return { ok: true, stopped: true };
  } catch (error) {
    if (error.code === 'ESRCH') {
      return { ok: true, stopped: false };
    }
    return { ok: false, code: 'process-stop-failed' };
  }
}

export function composeCommand(allocation, root, args) {
  if (!path.isAbsolute(root)) {
    throw new Error('Compose root must be absolute.');
  }
  return {
    file: 'docker',
    args: [
      'compose', '-p', allocation.composeProject,
      '-f', path.join(root, '.codex/runtime/compose.yaml'),
      ...args,
    ],
    env: {
      ILO_RUNTIME_ID: allocation.runtimeId,
      ILO_REPOSITORY_ID: allocation.repositoryId,
      ILO_ROOT_HASH: allocation.rootHash,
      LOCAL_POSTGRES_PORT: String(allocation.ports.postgres),
    },
  };
}

function ownershipLabels(allocation) {
  return {
    'org.docker.compose.project': allocation.composeProject,
    'app.ilo.runtime.id': allocation.runtimeId,
    'app.ilo.runtime.repository': allocation.repositoryId,
    'app.ilo.runtime.root': allocation.rootHash,
  };
}

function discoveryArgs(type, label, value) {
  const args = type === 'container' ? ['ps', '--all'] : [type, 'ls'];
  args.push('--filter', `label=${label}=${value}`);
  args.push('--format', '{{.ID}}');
  return args;
}

function parseIds(output) {
  return String(output).split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
}

async function inspectDockerResource(run, type, id) {
  const result = normalizeCommandResult(await run('docker', ['inspect', '--type', type, id]));
  const parsed = JSON.parse(result.stdout);
  const resource = parsed[0];
  return { id, labels: resource?.Labels ?? resource?.Config?.Labels ?? {} };
}

export async function inspectOwnedDockerResources(allocation, adapters = {}) {
  const run = adapters.execFile ?? execFile;
  const expected = ownershipLabels(allocation);
  const found = { containers: [], networks: [], volumes: [] };
  try {
    for (const [type, key] of [
      ['container', 'containers'],
      ['network', 'networks'],
      ['volume', 'volumes'],
    ]) {
      const ids = new Set();
      for (const label of ['org.docker.compose.project', 'app.ilo.runtime.id']) {
        const result = normalizeCommandResult(await run('docker', discoveryArgs(type, label, expected[label])));
        for (const id of parseIds(result.stdout)) {
          ids.add(id);
        }
      }
      for (const id of ids) {
        const inspected = await inspectDockerResource(run, type, id);
        const matches = Object.entries(expected).every(([label, value]) => inspected.labels[label] === value);
        if (!matches) {
          return { ok: false, code: 'docker-label-mismatch', resource: { type, id } };
        }
        found[key].push(id);
      }
    }
    return { ok: true, resources: found };
  } catch (error) {
    return {
      ok: false,
      code: error.code === 'ENOENT' ? 'docker-unavailable' : 'docker-inspect-failed',
    };
  }
}

export async function removeOwnedDockerResources(allocation, adapters = {}) {
  const run = adapters.execFile ?? execFile;
  const inspected = await inspectOwnedDockerResources(allocation, { ...adapters, execFile: run });
  if (!inspected.ok) {
    return inspected;
  }
  try {
    for (const id of inspected.resources.containers) {
      await run('docker', ['container', 'rm', '--force', id]);
    }
    for (const id of inspected.resources.networks) {
      await run('docker', ['network', 'rm', id]);
    }
    for (const id of inspected.resources.volumes) {
      await run('docker', ['volume', 'rm', id]);
    }
    return { ok: true, removed: inspected.resources };
  } catch {
    return { ok: false, code: 'docker-remove-failed' };
  }
}
