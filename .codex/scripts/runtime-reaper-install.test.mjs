import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  inspectInstalledReaper,
  installReaper,
  uninstallReaper,
} from './runtime-reaper-install.mjs';

const repositoryId = '0123456789abcdef0123456789abcdef';

async function fixture(t) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'ilo-reaper-test-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const calls = [];
  return {
    home,
    calls,
    platform: 'darwin',
    uid: 501,
    nodePath: '/opt/node/bin/node',
    gitPath: '/usr/bin/git',
    dockerPath: '/usr/local/bin/docker',
    lsofPath: '/usr/sbin/lsof',
    psPath: '/bin/ps',
    gitCommonDir: '/Users/test/project/.git',
    repositoryId,
    sourceDir: path.resolve('.codex/scripts'),
    sourceCommit: 'abc123',
    execFile: async (file, args) => { calls.push([file, ...args]); return { stdout: '' }; },
  };
}

test('install writes a private versioned bundle and exact LaunchAgent then bootstraps once', async (t) => {
  const options = await fixture(t);
  const first = await installReaper(options);
  const second = await installReaper(options);
  assert.equal(first.status, 'installed');
  assert.equal(second.status, 'current');
  assert.equal(options.calls.filter((call) => call.includes('bootstrap')).length, 1);
  const plist = await readFile(first.plistPath, 'utf8');
  assert.match(plist, /\/opt\/node\/bin\/node/);
  assert.match(plist, /StartInterval/);
  assert.match(plist, /<integer>60<\/integer>/);
  assert.match(plist, /\/Users\/test\/project\/\.git\/worktrees/);
  assert.equal((await stat(first.bundleDir)).mode & 0o777, 0o700);
  assert.equal((await stat(path.join(first.bundleDir, 'manifest.json'))).mode & 0o777, 0o600);
});

test('inspection detects compatibility and refuses newer installed protocols', async (t) => {
  const options = await fixture(t);
  await installReaper(options);
  assert.equal((await inspectInstalledReaper(options)).status, 'current');
  await assert.rejects(
    () => installReaper({ ...options, protocolVersion: 0 }),
    /refusing to downgrade/i,
  );
  const paths = await inspectInstalledReaper(options);
  const manifestPath = path.join(paths.bundleDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  await writeFile(manifestPath, `${JSON.stringify({ ...manifest, repositoryId: 'f'.repeat(32) })}\n`);
  await assert.rejects(() => installReaper(options), /repository identity/i);
});

test('uninstall boots out and removes only the matching repository bundle and plist', async (t) => {
  const options = await fixture(t);
  const installed = await installReaper(options);
  const result = await uninstallReaper(options);
  assert.equal(result.status, 'removed');
  assert.equal(options.calls.filter((call) => call.includes('bootout')).length, 1);
  await assert.rejects(() => stat(installed.bundleDir), /ENOENT/);
  assert.equal((await inspectInstalledReaper(options)).status, 'not-installed');
  assert.equal((await uninstallReaper(options)).status, 'not-installed');
});

test('unsupported platforms report clearly without filesystem mutation', async (t) => {
  const options = await fixture(t);
  const result = await inspectInstalledReaper({ ...options, platform: 'linux' });
  assert.equal(result.status, 'unsupported');
  await assert.rejects(() => installReaper({ ...options, platform: 'linux' }), /only supported on macOS/i);
});
