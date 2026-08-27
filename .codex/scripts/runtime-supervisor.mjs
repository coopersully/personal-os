#!/usr/bin/env node

import { spawn as nodeSpawn } from 'node:child_process';
import { open, mkdir, readFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { replaceAllocation, resolveRepositoryContext } from './runtime-registry.mjs';
import { inspectProcess } from './runtime-resources.mjs';

const modulePath = fileURLToPath(import.meta.url);

export function buildServiceSpecs(allocation, root, inheritedEnv = process.env) {
  const apiUrl = `http://127.0.0.1:${allocation.ports.api}`;
  const mcpUrl = `http://127.0.0.1:${allocation.ports.mcp}`;
  const webUrl = `http://localhost:${allocation.ports.web}`;
  const common = {
    ...inheritedEnv,
    ILO_RUNTIME_ID: allocation.runtimeId,
    ILO_REPOSITORY_ID: allocation.repositoryId,
  };
  return {
    api: {
      file: 'pnpm',
      args: ['--filter', '@personal-os/api', 'exec', 'tsx', 'watch', 'src/main.ts'],
      cwd: root,
      env: {
        ...common,
        HOST: '127.0.0.1',
        PORT: String(allocation.ports.api),
        APP_BASE_URL: webUrl,
        API_BASE_URL: apiUrl,
        ALLOWED_ORIGINS: `${webUrl},tauri://localhost,http://tauri.localhost`,
        DATABASE_URL: `postgres://personal_os:personal_os@127.0.0.1:${allocation.ports.postgres}/personal_os`,
        MCP_PUBLIC_URL: mcpUrl,
        GOOGLE_REDIRECT_URI: `${apiUrl}/v1/connectors/google/callback`,
        X_REDIRECT_URI: `${apiUrl}/v1/x-bookmarks/callback`,
      },
    },
    mcp: {
      file: 'pnpm',
      args: ['--filter', '@personal-os/mcp', 'exec', 'tsx', 'watch', 'src/http.ts'],
      cwd: root,
      env: {
        ...common,
        HOST: '127.0.0.1',
        PORT: String(allocation.ports.mcp),
        API_BASE_URL: apiUrl,
        MCP_PUBLIC_URL: mcpUrl,
        OAUTH_AUTHORIZATION_SERVER_URL: apiUrl,
      },
    },
    web: {
      file: 'pnpm',
      args: [
        '--filter', '@personal-os/web', 'exec', 'vite',
        '--host', '127.0.0.1', '--port', String(allocation.ports.web), '--strictPort',
      ],
      cwd: root,
      env: {
        ...common,
        VITE_API_BASE_URL: apiUrl,
        VITE_PROXY_API_TARGET: apiUrl,
      },
    },
  };
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function probeTcp(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(500, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function defaultReadiness(name, allocation) {
  if (name === 'postgres') {
    return probeTcp(allocation.ports.postgres);
  }
  const targets = {
    api: `http://127.0.0.1:${allocation.ports.api}/health/ready`,
    mcp: `http://127.0.0.1:${allocation.ports.mcp}/health/live`,
    web: `http://127.0.0.1:${allocation.ports.web}/`,
  };
  try {
    const response = await fetch(targets[name], { signal: AbortSignal.timeout(750) });
    return response.ok;
  } catch {
    return false;
  }
}

async function awaitReadiness(allocation, readiness) {
  for (const name of ['postgres', 'api', 'mcp', 'web']) {
    let ready = false;
    for (let attempt = 0; attempt < 120 && !ready; attempt += 1) {
      ready = await readiness(name, allocation);
      if (!ready) {
        await sleep(500);
      }
    }
    if (!ready) {
      throw new Error(`${name} did not become ready.`);
    }
  }
}

function processRecord(pid, identity, allocation, root, pgid) {
  return {
    pid,
    pgid,
    startIdentity: identity.startIdentity,
    commandMarker: `--runtime-id ${allocation.runtimeId}`,
    cwd: root,
  };
}

async function createLogStdio(root, name) {
  const directory = path.join(root, '.codex/run/logs');
  await mkdir(directory, { recursive: true });
  const handle = await open(path.join(directory, `${name}.log`), 'a', 0o600);
  return { handle, stdio: ['ignore', handle.fd, handle.fd] };
}

export async function runSupervisor(options) {
  const spawn = options.spawn ?? nodeSpawn;
  const env = options.env ?? process.env;
  const isChild = options.supervisorChild ?? env.ILO_RUNTIME_SUPERVISOR_CHILD === '1';
  if (!isChild) {
    const child = spawn(process.execPath, [modulePath, ...(options.argv ?? process.argv.slice(2))], {
      cwd: options.root,
      detached: true,
      stdio: 'inherit',
      env: { ...env, ILO_RUNTIME_SUPERVISOR_CHILD: '1' },
    });
    return waitForExit(child);
  }

  const allocation = options.allocation;
  const root = options.root ?? allocation.root;
  const specs = buildServiceSpecs(allocation, root, env);
  const identify = options.processIdentity ?? inspectProcess;
  const pgid = process.pid;
  const processes = {
    supervisor: processRecord(process.pid, await identify(process.pid), allocation, root, pgid),
  };
  const recordProcesses = options.recordProcesses ?? (async (records) => {
    const context = await resolveRepositoryContext(root);
    await replaceAllocation(context, {
      ...allocation,
      state: 'running',
      updatedAt: new Date().toISOString(),
      processes: records,
    });
  });
  await recordProcesses(processes);

  const children = [];
  const handles = [];
  for (const [name, spec] of Object.entries(specs)) {
    const logging = options.spawn ? { stdio: 'pipe' } : await createLogStdio(root, name);
    if (logging.handle) handles.push(logging.handle);
    const child = spawn(spec.file, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      detached: false,
      stdio: logging.stdio,
    });
    children.push({ name, child });
    const identity = await identify(child.pid);
    processes[name] = processRecord(child.pid, identity, allocation, root, pgid);
  }
  await recordProcesses(processes);

  const stopGroup = options.stopGroup ?? (async (signal) => process.kill(-pgid, signal));
  try {
    const exits = children.map(({ child }) => waitForExit(child).then((code) => ({ code })));
    const startup = await Promise.race([
      awaitReadiness(allocation, options.readiness ?? defaultReadiness).then(() => ({ ready: true })),
      ...exits,
    ]);
    if (!startup.ready) {
      await stopGroup('SIGTERM');
      return startup.code;
    }
    if (options.exitAfterReady) {
      return 0;
    }
    const signalExit = new Promise((resolve) => {
      process.once('SIGINT', () => resolve({ code: 130 }));
      process.once('SIGTERM', () => resolve({ code: 143 }));
    });
    const { code } = await Promise.race([...exits, signalExit]);
    await stopGroup('SIGTERM');
    return code;
  } catch (error) {
    await stopGroup('SIGTERM');
    process.stderr.write(`[ilo-runtime] ${error.message}\n`);
    return 1;
  } finally {
    await Promise.all(handles.map((handle) => handle.close()));
  }
}

function parseCliArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith('--') || argv[index + 1] === undefined) {
      throw new Error(`Invalid supervisor argument: ${argv[index] ?? ''}`);
    }
    values[argv[index].slice(2)] = argv[index + 1];
  }
  return values;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const allocation = JSON.parse(await readFile(args.allocation, 'utf8'));
  if (allocation.runtimeId !== args['runtime-id']) {
    throw new Error('Supervisor runtime ID does not match its allocation.');
  }
  process.exitCode = await runSupervisor({ allocation, root: allocation.root });
}

if (path.resolve(process.argv[1] ?? '') === modulePath) {
  main().catch((error) => {
    process.stderr.write(`[ilo-runtime] ${error.message}\n`);
    process.exitCode = 1;
  });
}
