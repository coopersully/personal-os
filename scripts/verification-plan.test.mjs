import assert from "node:assert/strict";
import test from "node:test";
import { planVerification } from "./verification-plan.mjs";

test("documentation edits do not launch TypeScript or application suites", () => {
  const plan = planVerification(["docs/engineering/code-standards.md"]);
  assert.deepEqual(plan.commands, [["pnpm", "check:repo"]]);
  assert.equal(plan.finalAcceptance, false);
});
test("domain change includes consumers and integration type checks", () => {
  const plan = planVerification(["packages/domain/src/task.ts"]);
  const command = plan.commands[0];
  assert.ok(command.includes("@personal-os/domain"));
  assert.ok(command.includes("@personal-os/api"));
  assert.ok(command.includes("@personal-os/web"));
  assert.ok(plan.commands.some((c) => c.includes("integration/tsconfig.json")));
});
test("unknown, invalid or empty input fails broad without shell execution", () => {
  for (const paths of [[], ["../outside"], ["unknown-path"], null]) {
    assert.deepEqual(planVerification(paths).commands, [["pnpm", "typecheck"]]);
  }
});
test("skill Python uses its focused tests without launching product compilation", () => {
  const plan = planVerification([".agents/skills/ship-it/scripts/acceptance.py"]);
  assert.deepEqual(plan.commands, [
    [
      "python3",
      "-m",
      "unittest",
      "discover",
      "-s",
      ".agents/skills/ship-it/scripts",
      "-p",
      "*_test.py",
    ],
  ]);
});

test("global scope preserves focused script tests in a mixed change", () => {
  const plan = planVerification([
    ".agents/skills/ship-it/scripts/acceptance.py",
    "tsconfig.base.json",
  ]);
  assert.equal(plan.commands.length, 2);
  assert.equal(plan.commands[0][0], "python3");
  assert.deepEqual(plan.commands[1], ["pnpm", "typecheck"]);
});

test("repository and Terraform changes select their focused checks", () => {
  assert.ok(
    planVerification([".codex/scripts/check.sh"]).commands.some(
      (c) => c.join(" ") === "pnpm check:repo",
    ),
  );
  const commands = planVerification(["infra/main.tf"]).commands;
  assert.equal(commands.length, 5);
  assert.deepEqual(commands[0], ["terraform", "fmt", "-check", "-recursive", "infra"]);
  assert.ok(commands.some((c) => c.join(" ") === "terraform -chdir=infra validate"));
});
