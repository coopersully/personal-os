#!/usr/bin/env node

import { execFile as execFileCallback, spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  acquireAllocation,
  deleteAllocation,
  getAllocationForRoot,
  listAllocations,
  migrateLegacyTiers,
  replaceAllocation,
  resolveRepositoryContext,
} from './runtime-registry.mjs';
import { reconcileRegistry } from './runtime-reconciler.mjs';
import {
  composeCommand,
  inspectOwnedDockerResources,
  probePort,
  removeOwnedDockerResources,
  stopOwnedProcessGroup,
} from './runtime-resources.mjs';

const execFile = promisify(execFileCallback);
const modulePath = fileURLToPath(import.meta.url);

const defaults = {
  acquireAllocation,
  deleteAllocation,
  getAllocationForRoot,
  inspectOwnedDockerResources,
  listAllocations,
  migrateLegacyTiers,
  probePort,
  reconcileRegistry,
  removeOwnedDockerResources,
  replaceAllocation,
  resolveRepositoryContext,
  stopOwnedProcessGroup,
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
};

function runtimeUrls(allocation) {
  return {
    web: `http://localhost:${allocation.ports.web}`,
    api: `http://127.0.0.1:${allocation.ports.api}`,
    mcp: `http://127.0.0.1:${allocation.ports.mcp}`,
  };
}

export function buildRuntimeOverlay(allocation) {
  const urls = runtimeUrls(allocation);
  const values = {
    CODEX_RUNTIME_TIER: allocation.tier,
    ILO_RUNTIME_ID: allocation.runtimeId,
    ILO_REPOSITORY_ID: allocation.repositoryId,
    ILO_ROOT_HASH: allocation.rootHash,
    LOCAL_WEB_PORT: allocation.ports.web,
    LOCAL_API_PORT: allocation.ports.api,
    LOCAL_MCP_PORT: allocation.ports.mcp,
    LOCAL_POSTGRES_PORT: allocation.ports.postgres,
    APP_BASE_URL: urls.web,
    API_BASE_URL: urls.api,
    DATABASE_URL: `postgres://personal_os:personal_os@127.0.0.1:${allocation.ports.postgres}/personal_os`,
    MCP_PUBLIC_URL: urls.mcp,
    GOOGLE_REDIRECT_URI: `${urls.api}/v1/connectors/google/callback`,
    X_REDIRECT_URI: `${urls.api}/v1/x-bookmarks/callback`,
    ALLOWED_ORIGINS: `${urls.web},tauri://localhost,http://tauri.localhost`,
    MCP_ALLOWED_ORIGINS: '',
    OAUTH_AUTHORIZATION_SERVER_URL: urls.api,
    PERSONAL_OS_API_URL: urls.api,
    VITE_API_BASE_URL: urls.api,
    VITE_PROXY_API_TARGET: urls.api,
  };
  return `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')}\n`;
}

export async function writeRuntimeOverlay(root, allocation) {
  const destination = path.join(root, '.env.codex.local');
  const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(buildRuntimeOverlay(allocation), 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, destination);
}

export function formatAllocation(allocation) {
  const urls = runtimeUrls(allocation);
  return [
    `  Root:      ${allocation.root}`,
    `  Tier:      ${allocation.tier}`,
    `  App:       ${urls.web}`,
    `  API:       ${urls.api}`,
    `  MCP:       ${urls.mcp}`,
    `  PostgreSQL 127.0.0.1:${allocation.ports.postgres}`,
    `  Compose:   ${allocation.composeProject}`,
  ].join('\n');
}

function parseArgs(argv) {
  const command = argv[0];
  const options = { positional: [] };
  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) {
      options.positional.push(value);
    } else if (['--dry-run', '--json', '--acknowledge-data-loss', '--installed-reaper'].includes(value)) {
      options[value.slice(2)] = true;
    } else {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`Option ${value} requires a value.`);
      }
      options[value.slice(2)] = next;
      index += 1;
    }
  }
  return { command, options };
}

async function runCommand(command, adapters) {
  const run = adapters.execFile ?? execFile;
  return run(command.file, command.args, {
    cwd: command.cwd,
    env: { ...process.env, ...command.env },
  });
}

async function waitForPostgres(allocation, adapters) {
  const command = composeCommand(allocation, allocation.root, [
    'exec', '-T', 'postgres', 'pg_isready', '-U', 'personal_os', '-d', 'personal_os',
  ]);
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      await runCommand(command, adapters);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error('PostgreSQL did not become ready.');
}

async function spawnAttached(file, args, options) {
  const child = spawn(file, args, { ...options, stdio: 'inherit' });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
}

async function currentAllocation(context, adapters) {
  return adapters.getAllocationForRoot(context, context.root);
}

async function reconcile(context, adapters, options = {}) {
  return adapters.reconcileRegistry(context, options);
}

async function commandStart(context, options, adapters) {
  await reconcile(context, adapters);
  await adapters.migrateLegacyTiers(context);
  const allocation = await adapters.acquireAllocation(context, {
    probePort: async (port) => (await adapters.probePort(port)).available,
    ...(options.tier ? { requestedTier: Number(options.tier) } : {}),
  });
  if (allocation.state === 'running' && allocation.processes?.supervisor) {
    throw new Error('This checkout already has a running supervisor. Use Status or Stop.');
  }
  await writeRuntimeOverlay(context.root, allocation);
  const inspected = await adapters.inspectOwnedDockerResources(allocation, adapters);
  if (!inspected.ok) {
    throw new Error(`Refusing Docker startup: ${inspected.code}.`);
  }
  let postgresStarted = false;
  try {
    await runCommand(composeCommand(allocation, context.root, ['up', '-d', 'postgres']), adapters);
    postgresStarted = true;
    await waitForPostgres(allocation, adapters);
    adapters.stdout(formatAllocation(allocation));
    const supervisorPath = path.join(context.root, '.codex/scripts/runtime-supervisor.mjs');
    const recordPath = path.join(context.registryDir, 'allocations', `${allocation.runtimeId}.json`);
    const code = await (adapters.spawnAttached ?? spawnAttached)(process.execPath, [
      supervisorPath, '--allocation', recordPath, '--runtime-id', allocation.runtimeId,
    ], { cwd: context.root, env: process.env });
    const latest = await adapters.getAllocationForRoot(context, context.root);
    if (latest?.state === 'running') {
      await adapters.replaceAllocation(context, {
        ...latest,
        state: 'stopped',
        processes: {},
        updatedAt: new Date().toISOString(),
      }, { expectedState: 'running' });
    }
    return code;
  } catch (error) {
    if (postgresStarted) {
      await runCommand(composeCommand(allocation, context.root, ['stop', 'postgres']), adapters).catch(() => {});
    }
    throw error;
  }
}

async function commandStop(context, adapters) {
  const allocation = await currentAllocation(context, adapters);
  if (!allocation) {
    adapters.stdout('State: unallocated');
    return 0;
  }
  const processResult = await adapters.stopOwnedProcessGroup(allocation, adapters);
  if (!processResult.ok) {
    throw new Error(`Refusing process stop: ${processResult.code}.`);
  }
  const inspected = await adapters.inspectOwnedDockerResources(allocation, adapters);
  if (!inspected.ok) {
    throw new Error(`Refusing Docker stop: ${inspected.code}.`);
  }
  if (inspected.resources.containers.length > 0) {
    await runCommand(composeCommand(allocation, context.root, ['stop', 'postgres']), adapters);
  }
  await adapters.replaceAllocation(context, {
    ...allocation,
    state: 'stopped',
    processes: {},
    updatedAt: new Date().toISOString(),
  });
  adapters.stdout('ilo is stopped. PostgreSQL data and the runtime allocation are preserved.');
  return 0;
}

async function commandPurge(context, options, adapters) {
  if (!options['acknowledge-data-loss']) {
    adapters.stderr('Purge requires --acknowledge-data-loss.');
    return 2;
  }
  const allocation = await currentAllocation(context, adapters);
  if (!allocation) return 0;
  if (allocation.processes?.supervisor) {
    adapters.stderr('Stop the runtime before purging it.');
    return 2;
  }
  const removed = await adapters.removeOwnedDockerResources(allocation, adapters);
  if (!removed.ok) throw new Error(`Refusing purge: ${removed.code}.`);
  await adapters.deleteAllocation(context, allocation.runtimeId);
  await rm(path.join(context.root, '.env.codex.local'), { force: true });
  adapters.stdout(`Purged runtime ${allocation.runtimeId} and its PostgreSQL data.`);
  return 0;
}

async function writeActiveRoot(context, root) {
  const destination = path.join(context.registryDir, 'active-root');
  const temporary = `${destination}.tmp-${process.pid}`;
  const handle = await open(temporary, 'w', 0o600);
  await handle.writeFile(`${root}\n`);
  await handle.sync();
  await handle.close();
  await rename(temporary, destination);
}

async function executablePath(name, fallback) {
  try {
    return (await execFile('which', [name])).stdout.trim();
  } catch {
    return fallback;
  }
}

async function reaperOptions(context) {
  let sourceCommit = 'unknown';
  try {
    sourceCommit = (await execFile('git', ['-C', context.root, 'rev-parse', 'HEAD'])).stdout.trim();
  } catch {}
  return {
    platform: process.platform,
    uid: process.getuid?.(),
    repositoryId: context.repositoryId,
    gitCommonDir: context.gitCommonDir,
    sourceDir: path.join(context.root, '.codex/scripts'),
    sourceCommit,
    nodePath: process.execPath,
    gitPath: await executablePath('git', '/usr/bin/git'),
    dockerPath: await executablePath('docker', 'docker'),
    lsofPath: await executablePath('lsof', '/usr/sbin/lsof'),
    psPath: await executablePath('ps', '/bin/ps'),
    execFile,
  };
}

export async function runManager(argv, overrides = {}) {
  const adapters = { ...defaults, ...overrides };
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    adapters.stderr(error.message);
    return 2;
  }
  const { command, options } = parsed;
  if (!command) return 2;
  const root = options.root ?? process.cwd();
  let context;
  try {
    if (options['installed-reaper']) {
      if (command !== 'gc' || !options['git-common-dir'] || !options['repository-id']) {
        throw new Error('Installed reaper mode only supports pinned GC.');
      }
      const storedId = (await readFile(path.join(options['git-common-dir'], 'ilo-runtime/repository-id'), 'utf8')).trim();
      if (storedId !== options['repository-id']) throw new Error('Installed reaper repository identity mismatch.');
      context = {
        gitCommonDir: options['git-common-dir'],
        registryDir: path.join(options['git-common-dir'], 'ilo-runtime'),
        repositoryId: storedId,
      };
      const manifest = JSON.parse(await readFile(path.join(path.dirname(modulePath), 'manifest.json'), 'utf8'));
      if (manifest.repositoryId !== storedId || manifest.gitCommonDir !== context.gitCommonDir) {
        throw new Error('Installed reaper manifest identity mismatch.');
      }
      adapters.runtimeExecFile = (file, args, execOptions) => execFile(
        manifest.executables[file] ?? file,
        args,
        execOptions,
      );
    } else {
      context = await adapters.resolveRepositoryContext(root);
    }
    if (['stop', 'status', 'config', 'list', 'doctor', 'purge', 'acquire', 'activate'].includes(command)) {
      await reconcile(context, adapters, { dryRun: command === 'gc' && options['dry-run'] });
    }
    if (command === 'start') return await commandStart(context, options, adapters);
    if (command === 'restart') {
      await commandStop(context, adapters);
      return commandStart(context, options, adapters);
    }
    if (command === 'stop') return commandStop(context, adapters);
    if (command === 'purge') return commandPurge(context, options, adapters);
    if (command === 'status') {
      const allocation = await currentAllocation(context, adapters);
      adapters.stdout(allocation ? `State: ${allocation.state}\n${formatAllocation(allocation)}` : 'State: unallocated');
      return 0;
    }
    if (command === 'config') {
      const allocation = await currentAllocation(context, adapters);
      if (!allocation) throw new Error('Current checkout has no runtime allocation. Run Start first.');
      adapters.stdout(options.json ? JSON.stringify(allocation, null, 2) : formatAllocation(allocation));
      return 0;
    }
    if (command === 'acquire' || command === 'activate') {
      await adapters.migrateLegacyTiers(context);
      const allocation = await adapters.acquireAllocation(context, {
        probePort: async (port) => (await adapters.probePort(port)).available,
        ...(options.positional[0] ? { requestedTier: Number(options.positional[0]) } : {}),
      });
      await writeRuntimeOverlay(context.root, allocation);
      if (command === 'activate') await writeActiveRoot(context, context.root);
      adapters.stdout(options.json ? JSON.stringify(allocation) : formatAllocation(allocation));
      return 0;
    }
    if (command === 'active-root') {
      const active = (await readFile(path.join(context.registryDir, 'active-root'), 'utf8')).trim();
      adapters.stdout(active);
      return 0;
    }
    if (command === 'list') {
      const allocations = await adapters.listAllocations(context);
      adapters.stdout(options.json ? JSON.stringify(allocations, null, 2) : allocations.map(formatAllocation).join('\n\n'));
      return 0;
    }
    if (command === 'gc') {
      const report = await adapters.reconcileRegistry(context, {
        dryRun: Boolean(options['dry-run']),
        ...(adapters.runtimeExecFile ? { execFile: adapters.runtimeExecFile } : {}),
      });
      adapters.stdout(options.json ? JSON.stringify(report, null, 2) : `Reconciled ${report.length} runtime allocation(s).`);
      return 0;
    }
    if (command === 'doctor') {
      const allocations = await adapters.listAllocations(context);
      adapters.stdout(`Registry: ${context.registryDir}\nAllocations: ${allocations.length}\nSchema: supported`);
      return 0;
    }
    if (['reaper-enable', 'reaper-disable', 'reaper-status'].includes(command)) {
      const installer = await import('./runtime-reaper-install.mjs');
      const installOptions = await reaperOptions(context);
      const result = command === 'reaper-enable'
        ? await installer.installReaper(installOptions)
        : command === 'reaper-disable'
          ? await installer.uninstallReaper(installOptions)
          : await installer.inspectInstalledReaper(installOptions);
      adapters.stdout(`Automatic cleanup: ${result.status}`);
      return result.status === 'unsupported' ? 1 : 0;
    }
    adapters.stderr(`Unknown runtime command: ${command}`);
    return 2;
  } catch (error) {
    adapters.stderr(error.message);
    return 1;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(modulePath)) {
  const code = await runManager(process.argv.slice(2));
  process.exitCode = code;
}
