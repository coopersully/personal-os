import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

it.each([
  ["the approved ritual backdrop", ".browser-ritual { backdrop-filter: blur(24px); }", "", true],
  ["a different ritual radius", ".browser-ritual { backdrop-filter: blur(48px); }", "", false],
  ["another selector", ".other-dialog { backdrop-filter: blur(24px); }", "", false],
  ["a nested card", ".browser-ritual .card { backdrop-filter: blur(24px); }", "", false],
  ["an arbitrary utility", "", 'const classes = "backdrop-blur-xl";', false],
] as const)("keeps the ritual theme exception narrow: %s", async (_label, css, source, allowed) => {
  const root = await mkdtemp(join(tmpdir(), "nohmi-theme-contract-"));
  const src = join(root, "apps/web/src");
  try {
    await mkdir(join(root, "scripts"), { recursive: true });
    await mkdir(join(src, "components"), { recursive: true });
    await cp(
      resolve("scripts/check-frontend-theme-contract.mjs"),
      join(root, "scripts/check-frontend-theme-contract.mjs"),
    );
    await cp(resolve("apps/web/src/components/ui"), join(src, "components/ui"), {
      recursive: true,
    });
    await writeFile(join(src, "styles.css"), css);
    await writeFile(join(src, "example.tsx"), source);
    const result = await execute(process.execPath, [
      join(root, "scripts/check-frontend-theme-contract.mjs"),
    ]).then(
      () => ({ passed: true, stderr: "" }),
      (error: { stderr: string }) => ({ passed: false, stderr: error.stderr }),
    );
    expect(result.passed).toBe(allowed);
    if (!allowed) expect(result.stderr).toMatch(/frosted backdrop|blurred or frosted treatment/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
