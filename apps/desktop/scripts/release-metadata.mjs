import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
export function validateVersion(tag, versions) {
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag))
    throw new Error("A stable vX.Y.Z tag is required");
  const version = tag.slice(1);
  if (versions.some((value) => value !== version))
    throw new Error("Tag, package, Cargo and Tauri versions must match");
  return version;
}
export function releaseManifest(
  version,
  assets,
  signature,
  notes,
  date = new Date().toISOString(),
) {
  const platforms = {};
  for (const arch of ["aarch64", "x86_64"]) {
    const base = `nohmi_${version}_${arch}`;
    for (const suffix of [".dmg", ".app.tar.gz", ".app.tar.gz.sig"]) {
      if (!assets.includes(base + suffix)) throw new Error(`Missing ${base}${suffix}`);
    }
    const sig = signature(`${base}.app.tar.gz.sig`).trim();
    if (!sig) throw new Error("Empty updater signature");
    platforms[`darwin-${arch}`] = {
      signature: sig,
      url: `https://github.com/coopersully/personal-os/releases/download/v${version}/${base}.app.tar.gz`,
    };
  }
  return { version, notes, pub_date: date, platforms };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [tag, directory, notesFile] = process.argv.slice(2);
  const root = new URL("../../../", import.meta.url);
  const read = (path) => readFileSync(new URL(path, root), "utf8");
  const versions = [
    JSON.parse(read("apps/desktop/package.json")).version,
    JSON.parse(read("apps/desktop/src-tauri/tauri.conf.json")).version,
    read("apps/desktop/src-tauri/Cargo.toml").match(/^version = "([^"]+)"/m)?.[1],
  ];
  const version = validateVersion(tag, versions);
  if (directory) {
    const files = readdirSync(directory);
    const manifest = releaseManifest(
      version,
      files,
      (name) => readFileSync(join(directory, name), "utf8"),
      readFileSync(notesFile, "utf8"),
    );
    writeFileSync(join(directory, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    writeFileSync(
      join(directory, "SHA256SUMS"),
      `${files
        .filter((f) => /\.(dmg|tar.gz)$/.test(f))
        .sort()
        .map(
          (name) =>
            `${createHash("sha256")
              .update(readFileSync(join(directory, name)))
              .digest("hex")}  ${name}`,
        )
        .join("\n")}\n`,
    );
  }
}
