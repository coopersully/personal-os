import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { setVersions } from "./automatic-release.mjs";

test("real Git release reservations retry, skip docs, include cumulative changes and preserve main", () => {
  const root = mkdtempSync(join(tmpdir(), "nohmi-release-git-"));
  const script = resolve("apps/desktop/scripts/automatic-release.mjs");
  const repo = join(root, "repo");
  const remote = join(root, "remote.git");
  const bin = join(root, "bin");
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  try {
    mkdirSync(repo);
    mkdirSync(bin);
    execFileSync("git", ["init", "--bare", remote], { stdio: "ignore" });
    git("init", "-b", "main");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.com");
    git("remote", "add", "origin", remote);
    for (const file of [
      "apps/desktop/package.json",
      "apps/desktop/src-tauri/Cargo.toml",
      "apps/desktop/src-tauri/Cargo.lock",
      "apps/desktop/src-tauri/tauri.conf.json",
    ]) {
      const dest = join(repo, file);
      mkdirSync(resolve(dest, ".."), { recursive: true });
      writeFileSync(dest, readFileSync(file));
    }
    setVersions("0.1.0", repo);
    mkdirSync(join(repo, "apps/web/src"), { recursive: true });
    writeFileSync(join(repo, "apps/web/src/app.ts"), "// initial\n");
    git("add", ".");
    git("commit", "-m", "Initial app");
    git("push", "origin", "main");
    writeFileSync(
      join(bin, "gh"),
      '#!/usr/bin/env node\nprocess.stdout.write(require("node:fs").readFileSync(process.env.RELEASES_FIXTURE));\n',
    );
    chmodSync(join(bin, "gh"), 0o755);
    const fixture = join(root, "releases.json");
    writeFileSync(fixture, "[[]]");
    const invoke = (sha) => {
      const output = join(root, "output");
      writeFileSync(output, "");
      execFileSync(process.execPath, [script], {
        cwd: repo,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          SOURCE_SHA: sha,
          GITHUB_OUTPUT: output,
          RELEASES_FIXTURE: fixture,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      return Object.fromEntries(
        readFileSync(output, "utf8")
          .trim()
          .split("\n")
          .map((line) => line.split("=")),
      );
    };
    const first = git("rev-parse", "HEAD");
    git("checkout", "--detach", first);
    const release = invoke(first);
    assert.equal(release.tag, "v0.1.1");
    assert.equal(git("rev-parse", "origin/main"), first);
    assert.equal(git("rev-parse", "v0.1.1^"), first);
    assert.equal(git("diff", "--name-only", first, release.ref).split("\n").length, 4);
    git("checkout", "main");
    assert.equal(invoke(first).ref, release.ref, "retry reuses immutable reserved commit");
    writeFileSync(
      fixture,
      JSON.stringify([[{ tag_name: "v0.1.1", draft: false, prerelease: false }]]),
    );
    git("checkout", "main");
    writeFileSync(join(repo, "README.md"), "Docs\n");
    git("add", ".");
    git("commit", "-m", "Docs");
    git("push", "origin", "main");
    assert.equal(invoke(git("rev-parse", "HEAD")).build, "false");
    writeFileSync(join(repo, "apps/web/src/app.ts"), "// new feature\n");
    git("add", ".");
    git("commit", "-m", "New feature\n\nDesktop-Release: minor");
    git("push", "origin", "main");
    const second = git("rev-parse", "HEAD");
    assert.equal(invoke(first).build, "false", "stale CI does not reserve a tag");
    assert.equal(invoke(second).tag, "v0.2.0");
    assert.equal(git("rev-parse", "origin/main"), second);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
