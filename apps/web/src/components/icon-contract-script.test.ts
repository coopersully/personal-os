import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

it("rejects dynamic imports from every restricted icon source", async () => {
  const repositoryRoot = await mkdtemp(resolve(tmpdir(), "ilo-icon-contract-"));
  const scriptsDirectory = resolve(repositoryRoot, "scripts");
  const appsDirectory = resolve(repositoryRoot, "apps");
  await mkdir(scriptsDirectory, { recursive: true });
  await mkdir(appsDirectory, { recursive: true });
  await copyFile(
    resolve(import.meta.dirname, "../../../../scripts/check-icon-contract.mjs"),
    resolve(scriptsDirectory, "check-icon-contract.mjs"),
  );
  await writeFile(
    resolve(appsDirectory, "dynamic-icons.ts"),
    [
      `void import("${["lucide", "react"].join("-")}");`,
      `void import("${["reicon", "react"].join("-")}/icons/Check");`,
      `void import("${["simple", "icons"].join("-")}");`,
    ].join("\n"),
  );

  const result = spawnSync(
    process.execPath,
    [resolve(scriptsDirectory, "check-icon-contract.mjs")],
    {
      encoding: "utf8",
    },
  );

  expect(result.status).toBe(1);
  expect(result.stderr).toContain("forbidden icon pack");
  expect(result.stderr).toContain("direct reicon-react import");
  expect(result.stderr).toContain("brand artwork outside the brand-mark registry");
});
