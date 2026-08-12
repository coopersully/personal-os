import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PUBLIC_SKILLS, validatePublicAgentSkills } from "./check-public-agent-skills.mjs";

const requiredContracts = {
  "ilo-current-state": ["do not write to GitHub", "GitHub is the delivery-state source of truth"],
  "ilo-product-planning": ["read-only", "No GitHub writes performed.", "$github-work-sync"],
  "github-work-sync": ["user explicitly asks", "Search before creating"],
  "create-pr": ["Default new PRs to draft", "pnpm verify"],
  "personal-os-qa": ["pnpm test:e2e", "control-in-app-browser"],
  "pr-shepherd": ["at most one planned action", "Never force-push without explicit authorization"],
};

async function withFixture(arrange) {
  const root = await mkdtemp(path.join(os.tmpdir(), "personal-os-public-skills-"));
  try {
    for (const skill of PUBLIC_SKILLS) {
      const skillDir = path.join(root, ".agents", "skills", skill);
      await mkdir(path.join(skillDir, "agents"), { recursive: true });
      const contracts = (requiredContracts[skill] ?? []).join("\n");
      await writeFile(
        path.join(skillDir, "SKILL.md"),
        `---\nname: ${skill}\ndescription: Use this Personal OS workflow.\n---\n\n# ${skill}\n${contracts}\n`,
      );
      await writeFile(
        path.join(skillDir, "agents", "openai.yaml"),
        'interface:\n  display_name: "Personal OS Workflow"\n  short_description: "A public workflow."\n  default_prompt: "Use this workflow."\n',
      );
    }
    await arrange(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await withFixture(async (root) => {
  assert.deepEqual(await validatePublicAgentSkills(root), []);
});

await withFixture(async (root) => {
  await rm(path.join(root, ".agents", "skills", "review-pr", "SKILL.md"));
  assert.match(
    (await validatePublicAgentSkills(root)).join("\n"),
    /Missing public skill: review-pr/,
  );
});

await withFixture(async (root) => {
  const privateDir = path.join(root, ".agents", "skills", "my-issues");
  await mkdir(privateDir, { recursive: true });
  await writeFile(path.join(privateDir, "SKILL.md"), "# private\n");
  const createPr = path.join(root, ".agents", "skills", "create-pr", "SKILL.md");
  await writeFile(
    createPr,
    "---\nname: create-pr\ndescription: Use this Personal OS workflow.\n---\n\nUse cooper/example.\n",
  );
  const errors = (await validatePublicAgentSkills(root)).join("\n");
  assert.match(errors, /Private-only skill must not be published: my-issues/);
  assert.match(errors, /references a personal branch prefix/);
});

console.log("Public agent skills validator tests passed.");
