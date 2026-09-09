#!/usr/bin/env node
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { loadRuntime } from "./commands.mjs";
import { authorizeAdoption, tick } from "./continuous.mjs";
import { controllerIO, stopOwnedChildren } from "./continuous-io.mjs";
import { privateFile, writePrivate } from "./safety.mjs";

process.umask(0o077);
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"])
  process.once(signal, () => {
    stopOwnedChildren();
    // Do not unwind and remove an operation lock while Docker might still be
    // completing a requested action. An interrupted transaction is attended.
    process.exit(128 + (signal === "SIGTERM" ? 15 : signal === "SIGINT" ? 2 : 1));
  });

try {
  const [action, configPath, repository, expectedDeployed, target, acknowledgement] =
    process.argv.slice(2);
  if (!["run", "once", "status", "adopt"].includes(action) || !configPath)
    throw new Error("Use run|once CONFIG BARE_REPOSITORY, or status CONFIG.");
  const runtime = loadRuntime(configPath);
  if (action === "status") {
    const statePath = join(runtime.root, "continuous-state.json");
    const state = existsSync(statePath) ? JSON.parse(privateFile(statePath)) : {};
    console.log(
      JSON.stringify(
        {
          configuredRevision: runtime.config.revision,
          deployed: state.deployed,
          phase: state.phase ?? "not-started",
          candidate: state.candidate,
          maintenance: existsSync(join(runtime.root, "maintenance.json")),
          locked: existsSync(join(runtime.root, "operation.lock")),
          updatedAt: state.updatedAt,
          completedAt: state.completedAt,
          error: state.error,
          cleanupError: state.cleanupError,
          health: state.health,
        },
        null,
        2,
      ),
    );
  } else {
    if (!repository || !isAbsolute(repository) || realpathSync(repository) !== repository)
      throw new Error("Supply the private canonical source repository path.");
    const stat = lstatSync(repository);
    if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0)
      throw new Error("Source repository must be an owned private directory.");
    const io = controllerIO(repository);
    if (action === "adopt") {
      await authorizeAdoption(configPath, io, expectedDeployed, target, acknowledgement);
      console.log(
        "One exact initial main revision authorized; running revision remains unchanged.",
      );
      process.exit(0);
    }
    do {
      try {
        await tick(configPath, io);
      } catch {
        // Keep the latest 100 sanitized observations, below 16 KiB. A corrupt
        // state or unavailable daemon cannot flood a LaunchAgent stdout log.
        const path = join(runtime.root, "continuous-errors.log");
        const previous = existsSync(path)
          ? privateFile(path).split("\n").filter(Boolean).slice(-99)
          : [];
        previous.push(
          JSON.stringify({
            at: new Date().toISOString(),
            error: existsSync(join(runtime.root, "operation.lock"))
              ? "operation-locked-inspect-owner"
              : "controller-check-failed",
          }),
        );
        writePrivate(path, `${previous.join("\n")}\n`);
        if (action === "once") process.exitCode = 1;
      }
      if (action === "once") break;
      await setTimeout(60_000);
    } while (action === "run");
  }
} catch {
  console.error(
    "Controller could not start. Check private configuration, source repository and state.",
  );
  process.exitCode = 1;
}
