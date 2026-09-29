#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "./commands.mjs";
import { writePrivate } from "./safety.mjs";

// Build clean committed source, never an operator's ignored .env or dirty tree.
process.umask(0o077);
let temporary;
try {
  const [revision, output, ...options] = process.argv.slice(2);
  if (!/^[a-f0-9]{40}$/.test(revision) || !output || existsSync(output))
    throw new Error("Supply a full existing commit and a new private image-manifest path.");
  if (
    options.length &&
    (options.length !== 4 || options[0] !== "--repository" || options[2] !== "--docker-host")
  )
    throw new Error(
      "Optional arguments must be --repository ABSOLUTE_PATH --docker-host DEDICATED_SOCKET.",
    );
  const repository = resolve(options[1] ?? new URL("../..", import.meta.url).pathname);
  const dockerHost = options[3] ?? process.env.DOCKER_HOST;
  if (!/^unix:\/\/\/[^\s]+\/\.colima\/nohmi-production\/docker\.sock$/.test(dockerHost ?? ""))
    throw new Error("Build requires the explicit dedicated nohmi-production Docker socket.");
  const env = { ...process.env, DOCKER_HOST: dockerHost };
  delete env.DOCKER_CONTEXT;
  if ((await run("git", ["-C", repository, "rev-parse", `${revision}^{commit}`])) !== revision)
    throw new Error("Release must resolve to the exact supplied commit.");
  temporary = mkdtempSync(join(tmpdir(), "ilo-release-build-"));
  const source = join(temporary, "source");
  mkdirSync(source);
  const archive = join(temporary, "source.tar");
  await run("git", ["-C", repository, "archive", revision], { output: archive });
  // Preserve Git's executable/read permissions despite our private host umask.
  // Nginx runs unprivileged and must read its root-owned copied configuration.
  await run("tar", ["-xpf", archive, "-C", source]);
  const images = {};
  for (const name of ["api", "mcp", "web"]) {
    console.log(`Building ${name} from ${revision} (private output capture).`);
    const tag = `ilo-local/${name}:${revision}`;
    await run(
      "docker",
      [
        "--host",
        dockerHost,
        "build",
        "--platform",
        "linux/arm64",
        "--target",
        name,
        "--label",
        `org.opencontainers.image.revision=${revision}`,
        "--build-arg",
        "VITE_API_BASE_URL=https://nohmi-api.coopersully.me",
        "-t",
        tag,
        source,
      ],
      { env, timeout: 3_600_000 },
    );
    images[name] = await run(
      "docker",
      ["--host", dockerHost, "image", "inspect", tag, "--format", "{{.Id}}"],
      { env },
    );
  }
  writePrivate(
    resolve(output),
    JSON.stringify({ revision, images, builtAt: new Date().toISOString() }, null, 2),
  );
  console.log("Application images built; private image manifest recorded.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (temporary) rmSync(temporary, { recursive: true });
}
