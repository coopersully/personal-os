import { existsSync } from "node:fs";
import { join } from "node:path";
import { composeModel, validateConfig } from "./compose.mjs";
import { privateFile, withLock, writePrivate } from "./safety.mjs";

const commit = /^[a-f0-9]{40}$/;
const pollInterval = 5 * 60_000;

export function eligibleRelease({ candidate, deployed, descendant, runs }) {
  if (!commit.test(candidate) || !commit.test(deployed) || candidate === deployed || !descendant)
    return false;
  const latest = runs
    .filter(
      (run) =>
        run.head_sha === candidate &&
        run.head_branch === "main" &&
        run.event === "push" &&
        run.path === ".github/workflows/ci.yml" &&
        run.head_repository?.full_name === "coopersully/personal-os",
    )
    .sort((a, b) => b.id - a.id)[0];
  return latest?.status === "completed" && latest.conclusion === "success";
}

// Attempts survive healthy observations, but expire after one hour. A changing
// container ID cannot inherit another container's consecutive failure count.
export function healthDecision(previous, containers, root, now) {
  const health = {},
    restart = [];
  for (const row of containers) {
    const labels = row.Config?.Labels;
    if (
      !/^[a-f0-9]{64}$/.test(row.Id) ||
      !row.State?.Running ||
      labels?.["com.docker.compose.project"] !== "nohmi-production" ||
      labels?.["com.docker.compose.project.working_dir"] !== root ||
      !["api", "mcp"].includes(labels?.["com.docker.compose.service"])
    )
      continue;
    const before = previous[row.Id] ?? { observations: 0, attempts: [] };
    const attempts = before.attempts.filter((at) => at > now - 3_600_000);
    let observations = row.State.Health?.Status === "unhealthy" ? before.observations + 1 : 0;
    if (observations >= 3 && attempts.length < 3 && (attempts.at(-1) ?? 0) <= now - 600_000) {
      restart.push(row.Id);
      attempts.push(now);
      observations = 0;
    }
    health[row.Id] = { observations, attempts };
  }
  return { health, restart };
}

function readState(root, deployed) {
  const path = join(root, "continuous-state.json");
  if (!existsSync(path)) return { version: 1, phase: "idle", deployed, health: {}, nextPollAt: 0 };
  const state = JSON.parse(privateFile(path));
  if (state.version !== 1 || !commit.test(state.deployed))
    throw new Error("Invalid controller state.");
  return state;
}

function nextConfig(config, manifest, candidate) {
  if (
    manifest.revision !== candidate ||
    Object.keys(manifest.images ?? {})
      .sort()
      .join() !== "api,mcp,web"
  )
    throw new Error("Build manifest differs from candidate.");
  return validateConfig({
    ...config,
    revision: candidate,
    images: { ...config.images, ...manifest.images },
  });
}

// Squash merges do not retain the commit identity of the attended migration
// release. An operator may authorize exactly one reviewed main SHA, without
// claiming that the currently running images already contain that revision.
export async function authorizeAdoption(configPath, io, expectedDeployed, target, acknowledgement) {
  if (
    acknowledgement !== "--attended-bootstrap" ||
    !commit.test(expectedDeployed) ||
    !commit.test(target) ||
    target === expectedDeployed
  )
    throw new Error("Explicit bootstrap revisions and acknowledgement required.");
  const initial = io.load(configPath);
  return withLock(initial.root, async () => {
    const runtime = io.load(configPath);
    const state = readState(runtime.root, runtime.config.revision);
    const activation = JSON.parse(privateFile(join(runtime.root, "activation.json")));
    if (
      state.phase !== "idle" ||
      state.completedAt ||
      state.bootstrapConsumed ||
      state.deployed !== expectedDeployed ||
      runtime.config.revision !== expectedDeployed ||
      activation.revision !== expectedDeployed
    )
      throw new Error("Bootstrap requires the exact initial active release.");
    if ((await io.main()) !== target || (await io.history(target, expectedDeployed)))
      throw new Error(
        "Bootstrap target must be current main and must not downgrade to an ancestor.",
      );
    if (
      !eligibleRelease({
        candidate: target,
        deployed: expectedDeployed,
        descendant: true,
        runs: await io.ci(target),
      })
    )
      throw new Error("Bootstrap target requires exact successful main push CI.");
    await io.check(runtime);
    state.adoption = { expectedDeployed, target };
    state.nextPollAt = 0;
    state.updatedAt = new Date().toISOString();
    writePrivate(join(runtime.root, "continuous-state.json"), JSON.stringify(state, null, 2));
  });
}

// io owns only external process/network boundaries. Receipts, eligibility,
// locking and the release switch are exercised against real files in tests.
export async function tick(configPath, io, now = Date.now()) {
  const initial = io.load(configPath);
  const root = initial.root;
  const maintenance = () => existsSync(join(root, "maintenance.json"));
  if (maintenance()) return;
  return withLock(root, async () => {
    if (maintenance()) return;
    let runtime = io.load(configPath);
    const state = readState(root, runtime.config.revision);
    const save = () => {
      state.updatedAt = new Date(now).toISOString();
      writePrivate(join(root, "continuous-state.json"), JSON.stringify(state, null, 2));
    };
    if (!["idle", "building"].includes(state.phase) || state.deployed !== runtime.config.revision) {
      state.phase = "blocked";
      state.error ??= "interrupted-switch-or-release-drift";
      save();
      return;
    }
    // A leftover build receipt without an operation lock is safe to retry: no
    // application writes were stopped or release files changed in this phase.
    state.phase = "idle";
    if (now < (state.nextHealthAt ?? 0)) return;
    state.nextHealthAt = now + 60_000;
    try {
      const decision = healthDecision(state.health ?? {}, await io.containers(runtime), root, now);
      state.health = decision.health;
      save(); // Budget a restart before issuing it, including a lost response.
      if (decision.restart.length && !maintenance()) await io.restart(runtime, decision.restart);
    } catch {
      // A gap is not consecutive, but a lost restart response still consumes
      // the saved attempt: forgetting it would create an unbounded restart loop.
      for (const row of Object.values(state.health ?? {})) row.observations = 0;
      state.error = "health-check-failed";
      save();
      return;
    }
    if (maintenance() || now < (state.nextPollAt ?? 0)) return;
    state.nextPollAt = now + pollInterval;
    save(); // A crash/relaunch must not burst anonymous GitHub requests.
    let candidate, next;
    try {
      candidate = await io.main();
      if (candidate === state.deployed) {
        state.error = null;
        save();
        return;
      }
      if (!commit.test(candidate)) throw new Error("Invalid main ref.");
      const descendant =
        (await io.history(state.deployed, candidate)) ||
        (!state.bootstrapConsumed &&
          state.adoption?.expectedDeployed === state.deployed &&
          state.adoption?.target === candidate);
      if (!descendant) {
        state.error = "main-is-not-a-descendant";
        save();
        return;
      }
      const runs = await io.ci(candidate);
      if (!eligibleRelease({ candidate, deployed: state.deployed, descendant, runs })) {
        state.error = "awaiting-successful-main-ci";
        save();
        return;
      }
      await io.check(runtime);
      state.phase = "building";
      state.candidate = candidate;
      save();
      next = nextConfig(runtime.config, await io.build(candidate, runtime), candidate);
      // Validate the new image provenance before stopping anything. Keep all
      // existing runtime files; this check does not use a prepared next config.
      if (io.checkImages) await io.checkImages(next);
      if (maintenance() || (await io.main()) !== candidate) {
        state.phase = "idle";
        state.error = "candidate-superseded-or-maintenance";
        save();
        return;
      }
    } catch {
      state.phase = "idle";
      state.error = "prepare-failed";
      state.nextPollAt = now + 15 * 60_000;
      save();
      return;
    }
    // From this durable boundary onward any failure needs attended diagnosis.
    // Never roll back configuration/schema or retry startup automatically.
    state.phase = "quiescing";
    state.previousConfig = runtime.config;
    state.nextConfig = next;
    state.error = null;
    save();
    try {
      await io.stop(runtime);
      await io.writersStopped(runtime);
      state.backup = await io.backup(runtime);
      // No release/schema mutation has happened yet. A new main or failed Git
      // recheck can safely resume the exact old release; maintenance keeps it
      // intentionally stopped. Save the phase before any startup attempt.
      let currentMain;
      try {
        currentMain = await io.main();
      } catch {
        currentMain = null;
      }
      if (maintenance() || currentMain !== candidate) {
        state.phase = "resuming-previous";
        state.error = "candidate-superseded-or-maintenance";
        save();
        if (!maintenance()) {
          await io.start(runtime);
          if (maintenance()) await io.stop(runtime);
          else await io.publish(runtime);
        }
        state.phase = "idle";
        save();
        return;
      }
      state.phase = "switching";
      const activation = JSON.parse(privateFile(join(root, "activation.json")));
      if (activation.revision !== state.deployed) throw new Error("Activation drift.");
      state.previousActivation = activation;
      save();
      writePrivate(configPath, JSON.stringify(next, null, 2));
      writePrivate(join(root, "compose.json"), JSON.stringify(composeModel(next), null, 2));
      writePrivate(
        join(root, "activation.json"),
        JSON.stringify({ ...activation, revision: candidate }, null, 2),
      );
      runtime = io.load(configPath);
      await io.check(runtime);
      await io.start(runtime);
      if (maintenance()) throw new Error("Maintenance requested during startup.");
      await io.publish(runtime);
      state.deployed = candidate;
      if (state.adoption) {
        state.bootstrapConsumed = true;
        delete state.adoption;
      }
      state.phase = "idle";
      state.health = {};
      state.completedAt = new Date().toISOString();
      // Retain one completed transaction/backup for operator reconciliation.
      save();
    } catch {
      state.phase = "blocked";
      state.error = "deployment-failed-attended-recovery-required";
      save();
      // An unsuccessful startup must not leave its Docker restart policy
      // repeatedly attempting migrations while the controller reports blocked.
      try {
        await io.stop(runtime);
      } catch {
        state.cleanupError = "writers-stop-failed";
        save();
      }
    }
  });
}
