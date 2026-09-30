import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { affectsDesktop, compareVersions, nextVersion, setVersions } from "./automatic-release.mjs";

test("release scope includes bundled UI, native code, shared dependencies and build inputs", () => {
  for (const file of [
    "apps/web/src/features/tasks/page.tsx",
    "apps/desktop/src-tauri/src/lib.rs",
    "packages/api-client/src/index.ts",
    "packages/domain/src/index.ts",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "patches/react.patch",
    ".github/workflows/release.yml",
  ])
    assert.equal(affectsDesktop(file), true, file);
  for (const file of [
    "docs/releasing.md",
    "apps/api/src/app.ts",
    "apps/mcp/src/server.ts",
    "infra/main.tf",
    "apps/web/src/page.test.tsx",
    "apps/desktop/README.md",
  ])
    assert.equal(affectsDesktop(file), false, file);
});
test("patch versions increase numerically beyond reserved and published tags", () => {
  assert.equal(nextVersion("0.1.0", [], ""), "0.1.1");
  assert.equal(
    nextVersion("0.1.0", ["v0.1.9", "v0.1.10", "desktop-candidate/99", "v9.0.0-beta"], ""),
    "0.1.11",
  );
  assert.equal(nextVersion("2.0.0", ["v1.0.0"], ""), "2.0.1");
  assert.ok(compareVersions("v2.0.0", "v1.999.99") > 0);
});
test("explicit release trailers select the highest requested bump", () => {
  assert.equal(nextVersion("0.1.0", [], "Add feature\n\nDesktop-Release: minor\n"), "0.2.0");
  assert.equal(
    nextVersion("0.1.0", [], "Desktop-Release: major\nDesktop-Release: minor\n"),
    "1.0.0",
  );
  assert.equal(nextVersion("0.1.0", [], "Mention Desktop-Release: major in text"), "0.1.1");
  assert.throws(() => nextVersion("latest", [], ""));
});
test("release stamping updates every app version without modifying dependency versions", () => {
  const root = mkdtempSync(join(tmpdir(), "nohmi-release-test-"));
  try {
    const desktop = join(root, "apps/desktop");
    mkdirSync(join(desktop, "src-tauri"), { recursive: true });
    writeFileSync(
      join(desktop, "package.json"),
      '{"version":"0.1.0","dependencies":{"example":"0.1.0"}}',
    );
    writeFileSync(join(desktop, "src-tauri/tauri.conf.json"), '{"version":"0.1.0"}');
    writeFileSync(
      join(desktop, "src-tauri/Cargo.toml"),
      '[package]\nname = "personal-os"\nversion = "0.1.0"\n',
    );
    writeFileSync(
      join(desktop, "src-tauri/Cargo.lock"),
      '[[package]]\nname = "personal-os"\nversion = "0.1.0"\n\n[[package]]\nname = "other"\nversion = "0.1.0"\n',
    );
    setVersions("1.2.3", root);
    assert.equal(JSON.parse(readFileSync(join(desktop, "package.json"))).version, "1.2.3");
    assert.equal(
      JSON.parse(readFileSync(join(desktop, "package.json"))).dependencies.example,
      "0.1.0",
    );
    assert.equal(
      JSON.parse(readFileSync(join(desktop, "src-tauri/tauri.conf.json"))).version,
      "1.2.3",
    );
    assert.match(readFileSync(join(desktop, "src-tauri/Cargo.toml"), "utf8"), /version = "1.2.3"/);
    assert.match(
      readFileSync(join(desktop, "src-tauri/Cargo.lock"), "utf8"),
      /name = "other"\nversion = "0.1.0"/,
    );
    assert.match(
      readFileSync(join(desktop, "src-tauri/Cargo.lock"), "utf8"),
      /name = "personal-os"\nversion = "1.2.3"/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
