import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

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

const ALLOWED_SKILL_DIRECTORIES = new Set([...PUBLIC_SKILLS, "shadcn"]);
const FORBIDDEN_REFERENCES = [
  { pattern: /cooper\//, label: "a personal branch prefix" },
  { pattern: /\/Users\//, label: "an absolute user path" },
  { pattern: /\.codex\/worktrees\//, label: "a local worktree path" },
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

function frontmatterSource(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  return match?.[1] ?? null;
}

function parseYamlMap(source, label, errors) {
  try {
    const parsed = parseYaml(source);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      errors.push(`${label} must contain a YAML mapping`);
      return null;
    }
    return parsed;
  } catch (error) {
    errors.push(`Invalid YAML in ${label}: ${error.message.split("\n")[0]}`);
    return null;
  }
}

async function filesUnder(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(target)));
    else if (entry.isFile()) files.push(target);
  }
  return files;
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
    const headerSource = frontmatterSource(skillText);
    if (!headerSource) {
      errors.push(`Missing YAML frontmatter: ${skill}/SKILL.md`);
    } else {
      const header = parseYamlMap(headerSource, `${skill}/SKILL.md frontmatter`, errors);
      if (header && header.name !== skill) {
        errors.push(`Skill name does not match its directory: ${skill}`);
      }
    }

    const metadataDocument = parseYamlMap(metadata, `${skill}/agents/openai.yaml`, errors);
    const metadataInterface = metadataDocument?.interface;
    if (
      !metadataInterface ||
      typeof metadataInterface !== "object" ||
      !["display_name", "short_description", "default_prompt"].every(
        (field) => typeof metadataInterface[field] === "string" && metadataInterface[field].trim(),
      )
    )
      errors.push(`Incomplete agent metadata: ${skill}`);

    if (/(?<!\$)\bilo\b/i.test(metadata)) {
      errors.push(`Human-facing metadata must use Personal OS, not ilo: ${skill}`);
    }

    const publicFiles = await filesUnder(skillDir);
    for (const { pattern, label } of FORBIDDEN_REFERENCES) {
      for (const publicFile of publicFiles) {
        const fileText = await readFile(publicFile, "utf8");
        if (pattern.test(fileText)) {
          errors.push(
            `Public skill ${skill} references ${label} in ${path.relative(skillDir, publicFile)}`,
          );
        }
      }
    }
    for (const phrase of REQUIRED_CONTRACTS[skill] ?? []) {
      if (!skillText.includes(phrase)) {
        errors.push(`Missing required workflow contract in ${skill}: ${phrase}`);
      }
    }
  }

  for (const skill of available) {
    if (!ALLOWED_SKILL_DIRECTORIES.has(skill))
      errors.push(`Unapproved skill directory must not be published: ${skill}`);
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
