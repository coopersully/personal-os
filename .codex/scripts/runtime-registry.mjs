import { execFile as execFileCallback } from 'node:child_process';
import { createHash, randomBytes as nodeRandomBytes } from 'node:crypto';
import {
  appendFile,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

export const SCHEMA_VERSION = 1;
export const REAPER_PROTOCOL_VERSION = 1;
export const MIN_TIER = 1;
export const MAX_TIER = 16;

const ALLOCATION_STATES = new Set([
  'allocated',
  'running',
  'stopped',
  'orphan-pending',
  'drifted',
  'releasing',
  'cleanup-failed',
]);
const AUDIT_LIMIT_BYTES = 1024 * 1024;

export class UnsupportedRegistrySchemaError extends Error {
  constructor(version) {
    super(`Runtime registry schema ${version} is newer than supported schema ${SCHEMA_VERSION}.`);
    this.name = 'UnsupportedRegistrySchemaError';
    this.version = version;
  }
}

export function portsForSlot(tier) {
  if (!Number.isInteger(tier) || tier < MIN_TIER || tier > MAX_TIER) {
    throw new Error(`Runtime tier must be between ${MIN_TIER} and ${MAX_TIER}.`);
  }
  const offset = 5 * (tier - 1);
  return {
    web: 8081 + offset,
    api: 8788 + offset,
    mcp: 8789 + offset,
    postgres: 55433 + offset,
  };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function trimOutput(result) {
  return String(result.stdout).trim();
}

async function git(root, ...args) {
  return trimOutput(await execFile('git', ['-C', root, ...args]));
}

async function writeAtomic(filePath, contents, mode = 0o600) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${nodeRandomBytes(4).toString('hex')}`;
  const handle = await open(temporaryPath, 'wx', mode);
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, filePath);
  try {
    const directory = await open(path.dirname(filePath), 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EISDIR'].includes(error.code)) {
      throw error;
    }
  }
}

async function readOrCreateRepositoryId(registryDir) {
  const filePath = path.join(registryDir, 'repository-id');
  try {
    const existing = (await readFile(filePath, 'utf8')).trim();
    if (!/^[a-f0-9]{32}$/.test(existing)) {
      throw new Error(`Invalid runtime repository identity in ${filePath}.`);
    }
    return existing;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
  const repositoryId = nodeRandomBytes(16).toString('hex');
  try {
    await writeAtomic(filePath, `${repositoryId}\n`);
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
    return readOrCreateRepositoryId(registryDir);
  }
  return repositoryId;
}

export async function resolveRepositoryContext(root) {
  if (String(root).includes('\0')) {
    throw new Error('Runtime root cannot contain NUL.');
  }
  const canonicalRoot = await realpath(root);
  const gitCommonDir = await git(canonicalRoot, 'rev-parse', '--path-format=absolute', '--git-common-dir');
  const gitDir = await git(canonicalRoot, 'rev-parse', '--path-format=absolute', '--git-dir');
  const primaryRoot = await realpath(path.dirname(gitCommonDir));
  const registryDir = path.join(gitCommonDir, 'ilo-runtime');
  await mkdir(path.join(registryDir, 'allocations'), { recursive: true, mode: 0o700 });
  await mkdir(path.join(registryDir, 'roots'), { recursive: true, mode: 0o700 });
  const repositoryId = await readOrCreateRepositoryId(registryDir);
  return {
    root: canonicalRoot,
    rootHash: sha256(canonicalRoot),
    gitDir,
    gitCommonDir,
    primaryRoot,
    registryDir,
    repositoryId,
  };
}

async function processStartIdentity(pid) {
  try {
    return trimOutput(await execFile('ps', ['-p', String(pid), '-o', 'lstart=']));
  } catch {
    return '';
  }
}

async function lockOwnerIsLive(owner) {
  if (!Number.isInteger(owner?.pid) || typeof owner?.startIdentity !== 'string') {
    return false;
  }
  try {
    process.kill(owner.pid, 0);
  } catch {
    return false;
  }
  return (await processStartIdentity(owner.pid)) === owner.startIdentity;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function withRegistryLock(context, operation, options = {}) {
  const timeoutMs = options.timeoutMs ?? 5000;
  const retryMs = options.retryMs ?? 50;
  const lockDirectory = path.join(context.registryDir, 'lock');
  const deadline = Date.now() + timeoutMs;
  const owner = {
    pid: process.pid,
    startIdentity: await processStartIdentity(process.pid),
    createdAt: new Date().toISOString(),
  };

  while (true) {
    try {
      await mkdir(lockDirectory, { mode: 0o700 });
      await writeAtomic(path.join(lockDirectory, 'owner.json'), `${JSON.stringify(owner)}\n`);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
      let existing = null;
      try {
        existing = JSON.parse(await readFile(path.join(lockDirectory, 'owner.json'), 'utf8'));
      } catch (readError) {
        if (readError.code !== 'ENOENT' && !(readError instanceof SyntaxError)) {
          throw readError;
        }
      }
      if (!existing) {
        if (Date.now() >= deadline) {
          throw new Error('Runtime registry lock owner is unavailable.');
        }
        await sleep(retryMs);
        continue;
      }
      if (await lockOwnerIsLive(existing)) {
        if (Date.now() >= deadline) {
          throw new Error(`Runtime registry lock is held by live PID ${existing.pid}.`);
        }
        await sleep(retryMs);
        continue;
      }
      await rm(lockDirectory, { recursive: true, force: true });
    }
  }

  try {
    return await operation();
  } finally {
    await rm(lockDirectory, { recursive: true, force: true });
  }
}

function validatePorts(ports, tier) {
  const expected = portsForSlot(tier);
  if (!ports || Object.keys(expected).some((name) => ports[name] !== expected[name])) {
    throw new Error(`Allocation tier ${tier} has invalid ports.`);
  }
}

function validateAllocation(value) {
  if (!value || typeof value !== 'object') {
    throw new Error('Allocation must be an object.');
  }
  if (Number.isInteger(value.schemaVersion) && value.schemaVersion > SCHEMA_VERSION) {
    throw new UnsupportedRegistrySchemaError(value.schemaVersion);
  }
  if (value.schemaVersion !== SCHEMA_VERSION) {
    throw new Error('Allocation has an unsupported schema version.');
  }
  if (!/^[a-f0-9]{12}$/.test(value.runtimeId)) {
    throw new Error('Allocation has an invalid runtime ID.');
  }
  if (!/^[a-f0-9]{32}$/.test(value.repositoryId)) {
    throw new Error('Allocation has an invalid repository ID.');
  }
  if (!path.isAbsolute(value.root) || !/^[a-f0-9]{64}$/.test(value.rootHash)) {
    throw new Error('Allocation has an invalid root identity.');
  }
  if (!path.isAbsolute(value.gitDir)) {
    throw new Error('Allocation has an invalid Git directory.');
  }
  if (!ALLOCATION_STATES.has(value.state)) {
    throw new Error('Allocation has an invalid state.');
  }
  validatePorts(value.ports, value.tier);
  if (value.composeProject !== `ilo-wt-${value.runtimeId}`) {
    throw new Error('Allocation has an invalid Compose project.');
  }
  return value;
}

async function quarantineRecord(context, filePath, contents) {
  const quarantineDirectory = path.join(context.registryDir, 'quarantine');
  await mkdir(quarantineDirectory, { recursive: true, mode: 0o700 });
  const destination = path.join(quarantineDirectory, `${path.basename(filePath)}.quarantined`);
  await writeAtomic(destination, contents);
  await rm(filePath, { force: true });
}

async function listAllocationsUnlocked(context) {
  const directory = path.join(context.registryDir, 'allocations');
  const names = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
  const allocations = [];
  for (const name of names) {
    const filePath = path.join(directory, name);
    const contents = await readFile(filePath, 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(contents);
    } catch {
      await quarantineRecord(context, filePath, contents);
      continue;
    }
    if (Number.isInteger(parsed?.schemaVersion) && parsed.schemaVersion > SCHEMA_VERSION) {
      throw new UnsupportedRegistrySchemaError(parsed.schemaVersion);
    }
    try {
      allocations.push(validateAllocation(parsed));
    } catch (error) {
      if (error instanceof UnsupportedRegistrySchemaError) {
        throw error;
      }
      await quarantineRecord(context, filePath, contents);
    }
  }
  return allocations;
}

export async function listAllocations(context) {
  return listAllocationsUnlocked(context);
}

function allocationPath(context, runtimeId) {
  return path.join(context.registryDir, 'allocations', `${runtimeId}.json`);
}

function rootIndexPath(context, rootHash) {
  return path.join(context.registryDir, 'roots', `${rootHash}.json`);
}

async function writeAllocationUnlocked(context, allocation) {
  validateAllocation(allocation);
  await writeAtomic(allocationPath(context, allocation.runtimeId), `${JSON.stringify(allocation, null, 2)}\n`);
  await writeAtomic(rootIndexPath(context, allocation.rootHash), `${JSON.stringify({
    runtimeId: allocation.runtimeId,
    root: allocation.root,
  })}\n`);
}

function createAllocation(context, tier, options) {
  const now = options.now?.() ?? new Date();
  const randomBytes = options.randomBytes ?? nodeRandomBytes;
  const runtimeId = randomBytes(6).toString('hex');
  return {
    schemaVersion: SCHEMA_VERSION,
    runtimeId,
    repositoryId: context.repositoryId,
    root: context.root,
    rootHash: context.rootHash,
    gitDir: context.gitDir,
    tier,
    ports: portsForSlot(tier),
    composeProject: `ilo-wt-${runtimeId}`,
    state: 'allocated',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    orphanedAt: null,
    cleanup: null,
    processes: {},
  };
}

export async function acquireAllocation(context, options = {}) {
  return withRegistryLock(context, async () => {
    const allocations = await listAllocationsUnlocked(context);
    const existing = allocations.find((allocation) => allocation.root === context.root);
    if (existing) {
      return existing;
    }

    let tier;
    if (context.root === context.primaryRoot) {
      const owner = allocations.find((allocation) => allocation.tier === 1);
      if (owner) {
        throw new Error(`Runtime tier 1 is already owned by ${owner.root}.`);
      }
      tier = 1;
    } else {
      const occupied = new Set(allocations.map((allocation) => allocation.tier));
      const probePort = options.probePort ?? (async () => true);
      for (let candidate = 2; candidate <= MAX_TIER; candidate += 1) {
        if (occupied.has(candidate)) {
          continue;
        }
        const candidatePorts = Object.values(portsForSlot(candidate));
        const results = await Promise.all(candidatePorts.map((port) => probePort(port)));
        if (results.every(Boolean)) {
          tier = candidate;
          break;
        }
      }
      if (!tier) {
        throw new Error('No linked runtime tiers are available. Run runtime Doctor for owners and conflicts.');
      }
    }

    const allocation = createAllocation(context, tier, options);
    await writeAllocationUnlocked(context, allocation);
    return allocation;
  });
}

export async function getAllocationForRoot(context, root = context.root) {
  const canonicalRoot = await realpath(root);
  const rootHash = sha256(canonicalRoot);
  let index;
  try {
    index = JSON.parse(await readFile(rootIndexPath(context, rootHash), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
  if (index.root !== canonicalRoot || !/^[a-f0-9]{12}$/.test(index.runtimeId)) {
    throw new Error(`Invalid runtime root index for ${canonicalRoot}.`);
  }
  const allocation = validateAllocation(JSON.parse(await readFile(allocationPath(context, index.runtimeId), 'utf8')));
  if (allocation.root !== canonicalRoot || allocation.rootHash !== rootHash) {
    throw new Error(`Runtime root index does not match allocation ${index.runtimeId}.`);
  }
  return allocation;
}

export async function replaceAllocation(context, allocation) {
  return withRegistryLock(context, async () => {
    validateAllocation(allocation);
    if (allocation.repositoryId !== context.repositoryId) {
      throw new Error('Allocation belongs to a different repository identity.');
    }
    const allocations = await listAllocationsUnlocked(context);
    const tierOwner = allocations.find((candidate) =>
      candidate.tier === allocation.tier && candidate.runtimeId !== allocation.runtimeId,
    );
    if (tierOwner) {
      throw new Error(`Runtime tier ${allocation.tier} is already owned by ${tierOwner.root}.`);
    }
    const rootOwner = allocations.find((candidate) =>
      candidate.root === allocation.root && candidate.runtimeId !== allocation.runtimeId,
    );
    if (rootOwner) {
      throw new Error(`Runtime root is already owned by ${rootOwner.runtimeId}.`);
    }
    await writeAllocationUnlocked(context, allocation);
    return allocation;
  });
}

export async function deleteAllocation(context, runtimeId) {
  return withRegistryLock(context, async () => {
    let allocation;
    try {
      allocation = validateAllocation(JSON.parse(await readFile(allocationPath(context, runtimeId), 'utf8')));
    } catch (error) {
      if (error.code === 'ENOENT') {
        return false;
      }
      throw error;
    }
    await rm(allocationPath(context, runtimeId), { force: true });
    await rm(rootIndexPath(context, allocation.rootHash), { force: true });
    const activeRootPath = path.join(context.registryDir, 'active-root');
    try {
      if ((await readFile(activeRootPath, 'utf8')).trim() === allocation.root) {
        await rm(activeRootPath, { force: true });
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
    return true;
  });
}

async function rotateAuditIfNeeded(context) {
  const current = path.join(context.registryDir, 'audit.ndjson');
  try {
    if ((await stat(current)).size < AUDIT_LIMIT_BYTES) {
      return;
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
  await rm(`${current}.3`, { force: true });
  for (let index = 2; index >= 1; index -= 1) {
    try {
      await rename(`${current}.${index}`, `${current}.${index + 1}`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }
  await rename(current, `${current}.1`);
}

export async function appendAuditEvent(context, event, options = {}) {
  await rotateAuditIfNeeded(context);
  const now = options.now?.() ?? new Date();
  const safeEvent = {
    timestamp: now.toISOString(),
    action: event.action,
    runtimeId: event.runtimeId,
    repositoryId: context.repositoryId,
    tier: event.tier,
    state: event.state,
    ...(event.errorCode ? { errorCode: event.errorCode } : {}),
  };
  await appendFile(path.join(context.registryDir, 'audit.ndjson'), `${JSON.stringify(safeEvent)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

async function registeredWorktreeRoots(context) {
  const { stdout } = await execFile('git', [
    '--git-dir',
    context.gitCommonDir,
    'worktree',
    'list',
    '--porcelain',
    '-z',
    '--expire',
    'now',
  ]);
  const roots = new Set();
  for (const field of String(stdout).split('\0')) {
    if (field.startsWith('worktree ')) {
      roots.add(field.slice('worktree '.length));
    }
  }
  return roots;
}

export async function migrateLegacyTiers(context, options = {}) {
  return withRegistryLock(context, async () => {
    const legacyDirectory = path.join(context.registryDir, 'tiers');
    let names;
    try {
      names = await readdir(legacyDirectory);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return { imported: 0, stale: 0 };
      }
      throw error;
    }
    const allocations = await listAllocationsUnlocked(context);
    const occupiedTiers = new Set(allocations.map((allocation) => allocation.tier));
    const occupiedRoots = new Set(allocations.map((allocation) => allocation.root));
    const registered = options.registeredRoots ?? await registeredWorktreeRoots(context);
    const candidates = [];
    let stale = 0;

    for (const name of names.sort((a, b) => Number(a) - Number(b))) {
      const tier = Number(name);
      if (!Number.isInteger(tier) || tier < MIN_TIER || tier > MAX_TIER) {
        continue;
      }
      const rawRoot = (await readFile(path.join(legacyDirectory, name), 'utf8')).trim();
      let root;
      try {
        root = await realpath(rawRoot);
      } catch (error) {
        if (error.code === 'ENOENT') {
          stale += 1;
          continue;
        }
        throw error;
      }
      if (!registered.has(root)) {
        stale += 1;
        continue;
      }
      if (occupiedTiers.has(tier) || occupiedRoots.has(root) || candidates.some((candidate) =>
        candidate.tier === tier || candidate.root === root,
      )) {
        throw new Error(`Legacy runtime tier ${tier} conflicts with an existing allocation.`);
      }
      const candidateContext = await resolveRepositoryContext(root);
      candidates.push({ context: candidateContext, tier, root });
    }

    for (const candidate of candidates) {
      const allocation = createAllocation(candidate.context, candidate.tier, options);
      await writeAllocationUnlocked(context, allocation);
    }
    await rename(legacyDirectory, path.join(context.registryDir, 'tiers.migrated'));
    return { imported: candidates.length, stale };
  });
}
