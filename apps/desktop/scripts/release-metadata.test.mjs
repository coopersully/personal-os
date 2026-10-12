import assert from "node:assert/strict";
import { test } from "node:test";
import { releaseManifest, validateVersion } from "./release-metadata.mjs";

const assets = ["aarch64", "x86_64"].flatMap((arch) => [
  `nohmi_0.1.0_${arch}.dmg`,
  `nohmi_0.1.0_${arch}.app.tar.gz`,
  `nohmi_0.1.0_${arch}.app.tar.gz.sig`,
]);
test("requires exact stable version agreement", () => {
  assert.equal(validateVersion("v0.1.0", ["0.1.0", "0.1.0"]), "0.1.0");
  for (const tag of ["0.1.0", "v0.1.0-beta.1", "v01.1.0"])
    assert.throws(() => validateVersion(tag, ["0.1.0"]));
  assert.throws(() => validateVersion("v0.1.0", ["0.2.0"]));
});
test("publishes both signed architectures with immutable version URLs", () => {
  const manifest = releaseManifest(
    "0.1.0",
    assets,
    () => "signature",
    "Notes",
    "2026-09-30T12:00:00Z",
  );
  assert.deepEqual(Object.keys(manifest.platforms), ["darwin-aarch64", "darwin-x86_64"]);
  assert.match(
    manifest.platforms["darwin-aarch64"].url,
    /download\/v0.1.0\/nohmi_0.1.0_aarch64.app.tar.gz$/,
  );
  assert.equal(manifest.platforms["darwin-x86_64"].signature, "signature");
});
test("rejects partial releases and empty signatures", () => {
  assert.throws(() => releaseManifest("0.1.0", assets.slice(1), () => "sig", "Notes"));
  assert.throws(() => releaseManifest("0.1.0", assets, () => " ", "Notes"));
});
