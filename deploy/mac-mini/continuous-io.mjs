import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  assertPrepared,
  assertWritersStopped,
  backup,
  loadRuntime,
  run,
  start,
  stop,
} from "./commands.mjs";
import { privateFile } from "./safety.mjs";

const repositoryUrl = "https://github.com/coopersully/personal-os.git";
const ownedGroups = new Set();
const killGroup = (pid) => {
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
};

export function stopOwnedChildren() {
  for (const pid of ownedGroups) killGroup(pid);
}

// The stable builder and every subprocess it creates share this process group.
// Even a failed parent cannot leave a child build running after releasing the
// operation lock. SIGKILL of this controller leaves the lock for human review.
export async function runOwned(command, args, { env = process.env, timeout = 4 * 3_600_000 } = {}) {
  const child = spawn(command, args, { env, detached: true, stdio: "ignore" });
  if (child.pid) ownedGroups.add(child.pid);
  const timer = setTimeout(() => {
    if (child.pid) killGroup(child.pid);
  }, timeout);
  try {
    await new Promise((resolve, reject) => {
      child.once("error", () => reject(new Error("Build process could not start.")));
      child.once("close", (code) =>
        code === 0 ? resolve() : reject(new Error("Build process failed.")),
      );
    });
  } finally {
    clearTimeout(timer);
    if (child.pid) {
      killGroup(child.pid);
      ownedGroups.delete(child.pid);
    }
  }
}

function dockerEnvironment(socket) {
  const env = { ...process.env, DOCKER_HOST: socket };
  delete env.DOCKER_CONTEXT;
  return env;
}

export function controllerIO(repository, overrides = {}) {
  const command = overrides.command ?? run;
  const owned = overrides.owned ?? runOwned;
  const request = overrides.fetch ?? fetch;
  const gitEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "/usr/bin/false",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
  };
  // Inherited Git injection must not redirect a public read to credentialed or
  // unrelated repositories. This bare repository is owned by production only.
  for (const key of Object.keys(gitEnv))
    if (
      key.startsWith("GIT_CONFIG_COUNT") ||
      key.startsWith("GIT_CONFIG_KEY_") ||
      key.startsWith("GIT_CONFIG_VALUE_") ||
      ["GIT_DIR", "GIT_WORK_TREE", "GIT_SSH_COMMAND"].includes(key)
    )
      delete gitEnv[key];
  const git = (args) =>
    command(
      "git",
      ["-c", "credential.helper=", "-c", "core.hooksPath=/dev/null", "-C", repository, ...args],
      { env: gitEnv, timeout: 120_000 },
    );
  return {
    load: loadRuntime,
    main: async () => {
      const line = await git(["ls-remote", "--exit-code", repositoryUrl, "refs/heads/main"]);
      if (!/^[a-f0-9]{40}\trefs\/heads\/main$/.test(line))
        throw new Error("Invalid public main ref.");
      return line.slice(0, 40);
    },
    history: async (deployed, candidate) => {
      await git(["fetch", "--no-tags", repositoryUrl, "+refs/heads/main:refs/heads/main"]);
      for (const sha of [deployed, candidate]) {
        if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Invalid release history revision.");
        try {
          if ((await git(["rev-parse", `${sha}^{commit}`])) === sha) continue;
        } catch {
          /* The initial attended commit may only exist on its public branch. */
        }
        await git(["fetch", "--no-tags", repositoryUrl, sha]);
        if ((await git(["rev-parse", `${sha}^{commit}`])) !== sha)
          throw new Error("Missing release history.");
      }
      // A failed Git command is unknown, never evidence of non-ancestry. In
      // particular bootstrap must not confuse an inspection error with safety.
      return (await git(["merge-base", deployed, candidate])) === deployed;
    },
    ci: async (sha) => {
      if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Invalid CI revision.");
      const url = `https://api.github.com/repos/coopersully/personal-os/actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=${sha}&per_page=20`;
      const response = await request(url, {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "nohmi-production-controller",
        },
        signal: AbortSignal.timeout(30_000),
        redirect: "error",
      });
      if (!response.ok) throw new Error("Public CI request failed.");
      const reader = response.body.getReader();
      let bytes = 0,
        body = "";
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.length;
          if (bytes > 1024 * 1024) throw new Error("CI response exceeded limit.");
          body += decoder.decode(value, { stream: true });
        }
      } finally {
        await reader.cancel();
      }
      const data = JSON.parse(body + decoder.decode());
      if (!Array.isArray(data.workflow_runs)) throw new Error("Invalid CI response.");
      return data.workflow_runs;
    },
    build: async (sha, runtime) => {
      const manifest = join(runtime.root, `build-${randomUUID()}.json`);
      try {
        await owned(
          process.execPath,
          [
            new URL("./build.mjs", import.meta.url).pathname,
            sha,
            manifest,
            "--repository",
            repository,
            "--docker-host",
            runtime.config.dockerHost,
          ],
          { env: dockerEnvironment(runtime.config.dockerHost) },
        );
        return JSON.parse(privateFile(manifest));
      } finally {
        if (existsSync(manifest)) rmSync(manifest);
      }
    },
    check: assertPrepared,
    checkImages: async (config) => {
      for (const name of ["api", "mcp", "web"]) {
        const revision = await command(
          "docker",
          [
            "--host",
            config.dockerHost,
            "image",
            "inspect",
            config.images[name],
            "--format",
            '{{ index .Config.Labels "org.opencontainers.image.revision" }}',
          ],
          { env: dockerEnvironment(config.dockerHost) },
        );
        if (revision !== config.revision) throw new Error("Candidate image provenance differs.");
      }
    },
    stop,
    writersStopped: assertWritersStopped,
    backup,
    start,
    publish: (runtime) => runtime.compose(["up", "-d", "--wait", "tunnel"], { timeout: 180_000 }),
    containers: async (runtime) => {
      const ids = (
        await runtime.docker([
          "ps",
          "--no-trunc",
          "-q",
          "--filter",
          "label=com.docker.compose.project=nohmi-production",
          "--filter",
          `label=com.docker.compose.project.working_dir=${runtime.root}`,
        ])
      )
        .split("\n")
        .filter(Boolean);
      if (ids.some((id) => !/^[a-f0-9]{64}$/.test(id)))
        throw new Error("Invalid container identity.");
      return ids.length ? JSON.parse(await runtime.docker(["inspect", ...ids])) : [];
    },
    restart: (runtime, ids) =>
      runtime.docker(["restart", "--time", "120", ...ids], { timeout: 300_000 }),
  };
}
