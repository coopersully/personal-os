import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { run } from "./commands.mjs";

test("builder archives the explicit commit and routes every Docker call to the dedicated socket", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "nohmi-build-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = join(directory, "source"),
    bin = join(directory, "bin");
  mkdirSync(source);
  mkdirSync(bin);
  writeFileSync(join(source, "Dockerfile"), "FROM scratch\n");
  await run("git", ["init", source]);
  await run("git", ["-C", source, "add", "Dockerfile"]);
  await run("git", [
    "-C",
    source,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "fixture",
  ]);
  const revision = await run("git", ["-C", source, "rev-parse", "HEAD"]);
  writeFileSync(join(source, ".env"), "PRIVATE_CANARY=true");
  const socket = "unix:///Users/nohmi-production/.colima/nohmi-production/docker.sock";
  const callsPath = join(directory, "calls.jsonl");
  const executable = join(bin, "docker");
  writeFileSync(
    executable,
    `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args[0] !== '--host' || args[1] !== ${JSON.stringify(socket)} || process.env.DOCKER_CONTEXT) process.exit(4);
if (args[2] === 'build' && fs.existsSync(path.join(args.at(-1), '.env'))) process.exit(5);
fs.appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(args)+'\\n');
if (args[2] === 'image') console.log('sha256:'+'d'.repeat(64));
`,
  );
  chmodSync(executable, 0o700);
  const output = join(directory, "images.json");
  await run(
    process.execPath,
    [
      new URL("./build.mjs", import.meta.url).pathname,
      revision,
      output,
      "--repository",
      source,
      "--docker-host",
      socket,
    ],
    {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        DOCKER_CONTEXT: "desktop-linux",
        DOCKER_HOST: "unix:///shared.sock",
      },
    },
  );
  const manifest = JSON.parse(readFileSync(output, "utf8"));
  assert.equal(manifest.revision, revision);
  assert.deepEqual(Object.keys(manifest.images).sort(), ["api", "mcp", "web"]);
  const calls = readFileSync(callsPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(calls.length, 6);
  for (const call of calls.filter((args) => args[2] === "build")) {
    assert.ok(call.includes(`org.opencontainers.image.revision=${revision}`));
    assert.ok(call.includes("linux/arm64"));
  }
});

test("builder refuses an implicit or shared Docker engine before running commands", async () => {
  for (const dockerHost of [undefined, "unix:///var/run/docker.sock"]) {
    await assert.rejects(
      run(
        process.execPath,
        [new URL("./build.mjs", import.meta.url).pathname, "a".repeat(40), "/unused/images.json"],
        {
          env: { ...process.env, DOCKER_HOST: dockerHost },
        },
      ),
    );
  }
});
