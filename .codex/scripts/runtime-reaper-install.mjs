import { copyFile, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { REAPER_PROTOCOL_VERSION, SCHEMA_VERSION } from "./runtime-registry.mjs";

const BUNDLE_FILES = [
  "runtime-registry.mjs",
  "runtime-resources.mjs",
  "runtime-reconciler.mjs",
  "runtime-manager.mjs",
];

function pathsFor(options) {
  const home = options.home ?? os.homedir();
  const shortId = options.repositoryId.slice(0, 12);
  return {
    bundleDir: path.join(home, "Library/Application Support/ilo-runtime", options.repositoryId),
    plistPath: path.join(home, "Library/LaunchAgents", `app.ilo.runtime-reaper.${shortId}.plist`),
    label: `app.ilo.runtime-reaper.${shortId}`,
  };
}

async function writePrivate(filePath, contents) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, filePath);
}

function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function createPlist(options, paths) {
  const manager = path.join(paths.bundleDir, "runtime-manager.mjs");
  const worktrees = path.join(options.gitCommonDir, "worktrees");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xml(paths.label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(options.nodePath ?? process.execPath)}</string>
    <string>${xml(manager)}</string>
    <string>gc</string>
    <string>--git-common-dir</string><string>${xml(options.gitCommonDir)}</string>
    <string>--repository-id</string><string>${xml(options.repositoryId)}</string>
    <string>--installed-reaper</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>60</integer>
  <key>WatchPaths</key><array><string>${xml(worktrees)}</string></array>
</dict>
</plist>
`;
}

function manifestFor(options) {
  return {
    repositoryId: options.repositoryId,
    schemaVersion: options.schemaVersion ?? SCHEMA_VERSION,
    protocolVersion: options.protocolVersion ?? REAPER_PROTOCOL_VERSION,
    sourceCommit: options.sourceCommit ?? "unknown",
    gitCommonDir: options.gitCommonDir,
    executables: {
      node: options.nodePath ?? process.execPath,
      git: options.gitPath ?? "/usr/bin/git",
      docker: options.dockerPath ?? "docker",
      lsof: options.lsofPath ?? "/usr/sbin/lsof",
      ps: options.psPath ?? "/bin/ps",
    },
    installedAt: (options.now?.() ?? new Date()).toISOString(),
  };
}

async function readManifest(paths) {
  try {
    return JSON.parse(await readFile(path.join(paths.bundleDir, "manifest.json"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function requireDarwin(options) {
  if ((options.platform ?? process.platform) !== "darwin") {
    throw new Error("Automatic runtime cleanup is only supported on macOS.");
  }
}

export async function inspectInstalledReaper(options) {
  if ((options.platform ?? process.platform) !== "darwin") {
    return { status: "unsupported" };
  }
  const paths = pathsFor(options);
  const manifest = await readManifest(paths);
  if (!manifest) return { status: "not-installed", ...paths };
  if (
    manifest.repositoryId !== options.repositoryId ||
    manifest.gitCommonDir !== options.gitCommonDir
  ) {
    return { status: "identity-mismatch", manifest, ...paths };
  }
  const missing = [];
  for (const file of [...BUNDLE_FILES, "manifest.json"]) {
    try {
      await stat(path.join(paths.bundleDir, file));
    } catch {
      missing.push(file);
    }
  }
  try {
    await stat(paths.plistPath);
  } catch {
    missing.push(path.basename(paths.plistPath));
  }
  if (missing.length) return { status: "incomplete", missing, manifest, ...paths };
  const requestedProtocol = options.protocolVersion ?? REAPER_PROTOCOL_VERSION;
  const requestedSchema = options.schemaVersion ?? SCHEMA_VERSION;
  if (manifest.protocolVersion > requestedProtocol || manifest.schemaVersion > requestedSchema) {
    return { status: "newer", manifest, ...paths };
  }
  const current =
    manifest.protocolVersion === requestedProtocol &&
    manifest.schemaVersion === requestedSchema &&
    manifest.sourceCommit === (options.sourceCommit ?? "unknown");
  return { status: current ? "current" : "refresh-needed", manifest, ...paths };
}

export async function installReaper(options) {
  requireDarwin(options);
  if (!/^[a-f0-9]{32}$/.test(options.repositoryId)) throw new Error("Invalid repository identity.");
  const paths = pathsFor(options);
  const inspected = await inspectInstalledReaper(options);
  if (inspected.status === "identity-mismatch")
    throw new Error("Installed reaper repository identity does not match.");
  if (inspected.status === "newer")
    throw new Error("Refusing to downgrade the installed reaper protocol or schema.");
  if (inspected.status === "current") return { status: "current", ...paths };

  await mkdir(paths.bundleDir, { recursive: true, mode: 0o700 });
  await mkdir(path.dirname(paths.plistPath), { recursive: true, mode: 0o700 });
  for (const file of BUNDLE_FILES) {
    await copyFile(path.join(options.sourceDir, file), path.join(paths.bundleDir, file));
    await (await import("node:fs/promises")).chmod(path.join(paths.bundleDir, file), 0o600);
  }
  await writePrivate(
    path.join(paths.bundleDir, "manifest.json"),
    `${JSON.stringify(manifestFor(options), null, 2)}\n`,
  );
  await writePrivate(paths.plistPath, createPlist(options, paths));

  if (inspected.status === "not-installed") {
    const run = options.execFile;
    const launchctl = options.launchctlPath ?? "/bin/launchctl";
    await run(launchctl, ["bootstrap", `gui/${options.uid}`, paths.plistPath]);
    await run(launchctl, ["kickstart", "-k", `gui/${options.uid}/${paths.label}`]);
    return { status: "installed", ...paths };
  }
  return { status: "refreshed", ...paths };
}

export async function refreshInstalledReaper(options) {
  const inspected = await inspectInstalledReaper(options);
  if (inspected.status === "not-installed" || inspected.status === "unsupported") return inspected;
  return installReaper(options);
}

export async function uninstallReaper(options) {
  requireDarwin(options);
  const paths = pathsFor(options);
  const inspected = await inspectInstalledReaper(options);
  if (inspected.status === "not-installed") return inspected;
  if (
    inspected.manifest?.repositoryId !== options.repositoryId ||
    inspected.manifest?.gitCommonDir !== options.gitCommonDir
  ) {
    throw new Error("Refusing to remove a reaper with mismatched repository identity.");
  }
  const run = options.execFile;
  const launchctl = options.launchctlPath ?? "/bin/launchctl";
  await run(launchctl, ["bootout", `gui/${options.uid}`, paths.plistPath]);
  await rm(paths.plistPath, { force: true });
  await rm(paths.bundleDir, { recursive: true, force: true });
  return { status: "removed", ...paths };
}
