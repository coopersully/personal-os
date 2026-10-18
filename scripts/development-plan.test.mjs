import assert from "node:assert/strict";
import test from "node:test";
import { buildPlan, receiptKey } from "./development-plan.mjs";

function input(paths = ["docs/product/workspaces.md"]) {
  return {
    version: 1,
    mode: "contribute",
    paths,
    scopeComplete: true,
    context: Object.fromEntries(
      ["source", "base", "verifier", "policy", "requirements", "metadata", "ownership"].map((k) => [
        k,
        `${k}-digest`,
      ]),
    ),
    authority: { track: true, implement: true, publish: true, deliver: true },
    receipts: [],
    coordination: false,
  };
}
function complete(s, step) {
  s.receipts.push({
    step,
    key: receiptKey(step, s.context),
    result: "pass",
    evidence: ["receipt.json"],
    owner: "agent",
    elapsedMs: 20,
  });
}
function stage(s, name) {
  return buildPlan(s).steps.find((x) => x.id === name);
}

test("docs get no iteration compiler but retain complete final gates", () => {
  const s = input();
  const p = buildPlan(s);
  assert.deepEqual(p.verification.iteration.commands, []);
  assert.deepEqual(p.verification.final.commands, [["pnpm", "verify"]]);
  assert.equal(p.mergeAuthorized, false);
  assert.equal(stage(s, "plan").status, "unnecessary");
});
test("UI API shared-contract and tooling changes retain conservative scope", () => {
  for (const paths of [
    ["apps/web/src/features/tasks/task.tsx"],
    ["packages/api/src/routes/tasks.ts"],
    ["packages/domain/src/task.ts"],
    [".agents/skills/ship-it/scripts/acceptance.py"],
  ]) {
    const p = buildPlan(input(paths));
    assert.ok(p.verification.iteration.commands.length);
    assert.deepEqual(p.verification.final.commands, [["pnpm", "verify"]]);
  }
  const p = buildPlan(input(["packages/domain/src/task.ts"]));
  assert.ok(p.verification.iteration.commands[0].includes("@personal-os/web"));
});
test("metadata changes reuse source verification but invalidate publication", () => {
  const s = input();
  complete(s, "verify-focused");
  complete(s, "verify-final");
  complete(s, "publish");
  s.context.metadata = "changed";
  assert.equal(stage(s, "verify-focused").status, "done");
  assert.equal(stage(s, "verify-final").status, "done");
  assert.notEqual(stage(s, "publish").status, "done");
});
test("source base verifier policy and requirements invalidate dependent receipts", () => {
  for (const field of ["source", "base", "verifier"]) {
    const s = input();
    complete(s, "verify-final");
    s.context[field] = "changed";
    assert.notEqual(stage(s, "verify-final").status, "done");
  }
  for (const field of ["policy", "requirements", "verifier"]) {
    const s = input();
    complete(s, "review");
    s.context[field] = "changed";
    assert.notEqual(stage(s, "review").status, "done");
  }
});
test("missing scope fails closed; malformed receipts never count", () => {
  const s = input();
  s.scopeComplete = false;
  assert.throws(() => buildPlan(s), /scope/);
  for (const change of [{ result: "fail" }, { evidence: [] }, { owner: "" }, { elapsedMs: -1 }]) {
    const s = input();
    complete(s, "understand");
    Object.assign(s.receipts[0], change);
    assert.notEqual(stage(s, "understand").status, "done");
  }
});
test("epic waits for planning and authority; discussion never launches implementation", () => {
  const s = input();
  s.coordination = true;
  complete(s, "understand");
  complete(s, "track");
  assert.equal(stage(s, "plan").status, "ready");
  assert.equal(stage(s, "implement").status, "waiting");
  s.mode = "plan";
  assert.equal(stage(s, "implement").status, "unnecessary");
  s.mode = "contribute";
  s.authority.track = false;
  s.receipts = [];
  complete(s, "understand");
  assert.equal(stage(s, "track").status, "blocked");
});
test("review mode does not mutate and pending stages do not rerun receipts", () => {
  const s = input();
  s.mode = "review";
  complete(s, "understand");
  assert.equal(stage(s, "implement").status, "unnecessary");
  assert.equal(stage(s, "publish").status, "unnecessary");
  assert.equal(stage(s, "verify-focused").status, "ready");
  complete(s, "verify-focused");
  assert.equal(stage(s, "review").status, "ready");
});
test("handoff resumes valid work and still requires final verification", () => {
  const s = input();
  s.mode = "deliver";
  for (const id of ["understand", "track", "implement", "verify-focused", "review", "publish"])
    complete(s, id);
  assert.equal(stage(s, "verify-final").status, "ready");
  assert.equal(stage(s, "deliver").status, "waiting");
  complete(s, "verify-final");
  assert.equal(stage(s, "deliver").status, "ready");
  s.authority.deliver = false;
  assert.equal(stage(s, "deliver").status, "blocked");
});

test("later failed evidence supersedes an older pass for the same inputs", () => {
  const s = input();
  complete(s, "verify-final");
  s.receipts.push({ ...s.receipts[0], result: "fail", evidence: ["failure.json"] });
  assert.notEqual(stage(s, "verify-final").status, "done");
});
