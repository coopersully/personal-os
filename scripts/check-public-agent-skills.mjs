import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const PUBLIC_SKILLS = [
  "catchup",
  "create-pr",
  "github-issue-janitor",
  "github-work-context",
  "github-work-sync",
  "ilo-current-state",
  "ilo-deploy-status",
  "ilo-knowledge-base",
  "ilo-product-planning",
  "personal-os-architecture",
  "personal-os-database",
  "personal-os-frontend",
  "personal-os-mcp",
  "personal-os-qa",
  "personal-os-testing",
  "pr-briefing",
  "pr-shepherd",
  "resolve-pr-comments",
  "review-pr",
];

const PRIVATE_SKILLS = ["ilo-project-orchestration", "my-issues"];
const FORBIDDEN_REFERENCES = [
  { pattern: /cooper\//, label: "a personal branch prefix" },
  { pattern: /\$my-issues\b/, label: "the private work-queue skill" },
  { pattern: /\$ilo-project-orchestration\b/, label: "the private orchestration skill" },
];

const REQUIRED_CONTRACTS = {
  "ilo-current-state": ["do not write to GitHub", "GitHub is the delivery-state source of truth"],
  "ilo-product-planning": ["read-only", "No GitHub writes performed.", "$github-work-sync"],
  "github-work-sync": ["user explicitly asks", "Search before creating"],
  "create-pr": ["Default new PRs to draft", "pnpm verify"],
  "personal-os-qa": ["pnpm test:e2e", "control-in-app-browser"],
  "pr-shepherd": ["at most one planned action", "Never force-push without explicit authorization"],
};

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function frontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  return match?.[1] ?? null;
}

export async function validatePublicAgentSkills(root) {
  const errors = [];
  const skillsRoot = path.join(root, ".agents", "skills");
  const available = (await exists(skillsRoot)) ? await readdir(skillsRoot) : [];

  for (const skill of PUBLIC_SKILLS) {
    const skillDir = path.join(skillsRoot, skill);
    const skillFile = path.join(skillDir, "SKILL.md");
    const metadataFile = path.join(skillDir, "agents", "openai.yaml");

    if (!(await exists(skillFile))) {
      errors.push(`Missing public skill: ${skill}`);
      continue;
    }
    if (!(await exists(metadataFile))) {
      errors.push(`Missing agent metadata: ${skill}/agents/openai.yaml`);
      continue;
    }

    const skillText = await readFile(skillFile, "utf8");
    const metadata = await readFile(metadataFile, "utf8");
    const header = frontmatter(skillText);
    if (!header) {
      errors.push(`Missing YAML frontmatter: ${skill}/SKILL.md`);
    } else if (!header.match(new RegExp(`^name: ${skill}$`, "m"))) {
      errors.push(`Skill name does not match its directory: ${skill}`);
    }
    if (
      !/^interface:\n {2}display_name: .+\n {2}short_description: .+\n {2}default_prompt: .+$/m.test(
        metadata,
      )
    ) {
      errors.push(`Incomplete agent metadata: ${skill}`);
    }
    if (/(?<!\$)\bilo\b/i.test(metadata)) {
      errors.push(`Human-facing metadata must use Personal OS, not ilo: ${skill}`);
    }

    for (const { pattern, label } of FORBIDDEN_REFERENCES) {
      if (pattern.test(`${skillText}\n${metadata}`)) {
        errors.push(`Public skill ${skill} references ${label}`);
      }
    }
    for (const phrase of REQUIRED_CONTRACTS[skill] ?? []) {
      if (!skillText.includes(phrase)) {
        errors.push(`Missing required workflow contract in ${skill}: ${phrase}`);
      }
    }
  }

  for (const privateSkill of PRIVATE_SKILLS) {
    if (available.includes(privateSkill)) {
      errors.push(`Private-only skill must not be published: ${privateSkill}`);
    }
  }

  return errors;
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const errors = await validatePublicAgentSkills(root);
  if (errors.length > 0) {
    console.error("Public agent skills check failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Public agent skills check passed (${PUBLIC_SKILLS.length} skills).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
