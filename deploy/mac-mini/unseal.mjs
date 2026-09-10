#!/usr/bin/env node
import { existsSync, lstatSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fileDigest, run } from "./commands.mjs";
import { privateFile, writePrivate } from "./safety.mjs";

export async function unseal(sealedPath, keyPath, destination) {
  const sealed = resolve(sealedPath),
    dump = resolve(destination);
  if (existsSync(dump) || existsSync(`${dump}.json`))
    throw new Error("Choose a new recovery dump filename.");
  const stat = lstatSync(sealed);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid() ||
    (stat.mode & 0o077) !== 0
  )
    throw new Error("Backup must be an owned private regular file.");
  privateFile(keyPath);
  const manifest = JSON.parse(privateFile(`${sealed}.json`));
  if (
    manifest.version !== 1 ||
    manifest.mode !== "recovery" ||
    manifest.encryptedSha256 !== (await fileDigest(sealed)) ||
    !/^[a-f0-9]{64}$/.test(manifest.dumpSha256) ||
    !manifest.serverVersion ||
    !manifest.locale
  )
    throw new Error("Recovery backup metadata/hash is invalid.");
  try {
    await run("age", ["--decrypt", "--identity", resolve(keyPath), sealed], {
      output: dump,
      timeout: 3600000,
    });
    if ((await fileDigest(dump)) !== manifest.dumpSha256)
      throw new Error("Decrypted backup hash differs from its manifest.");
    writePrivate(`${dump}.json`, JSON.stringify(manifest, null, 2));
  } catch (error) {
    if (existsSync(dump)) rmSync(dump);
    throw error;
  }
  return "Recovery backup decrypted and hash-verified. Restore into a separate empty target.";
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.umask(0o077);
  try {
    console.log(await unseal(...process.argv.slice(2)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
