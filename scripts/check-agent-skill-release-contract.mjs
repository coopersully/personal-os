import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { migrateLegacyAgentSkillEnvironment } from "./migrate-agent-skill-environment.mjs";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(
  readFileSync(resolve(root, "packages/domain/src/ilo-setup-release.json"), "utf8"),
);
const exampleEnvironment = readFileSync(resolve(root, ".env.example"), "utf8");
const compose = readFileSync(resolve(root, "compose.yaml"), "utf8");

const expectedEnvironment = [
  `AGENT_SKILL_SOURCE_URL=${manifest.sourceUrl}`,
  `AGENT_SKILL_VERSION=${manifest.version}`,
  `AGENT_SKILL_REVISION=${manifest.revision}`,
];
for (const line of expectedEnvironment) {
  if (!exampleEnvironment.split(/\r?\n/).includes(line)) {
    throw new Error(`.env.example diverges from the Ilo setup release manifest: ${line}`);
  }
}

const expectedCompose = [
  `AGENT_SKILL_SOURCE_URL: \${AGENT_SKILL_SOURCE_URL:-${manifest.sourceUrl}}`,
  `AGENT_SKILL_VERSION: \${AGENT_SKILL_VERSION:-${manifest.version}}`,
  `AGENT_SKILL_REVISION: \${AGENT_SKILL_REVISION:-${manifest.revision}}`,
];
for (const line of expectedCompose) {
  if (!compose.includes(line)) {
    throw new Error(`compose.yaml diverges from the Ilo setup release manifest: ${line}`);
  }
}

const legacyEnvironment = `APP_BASE_URL=https://app.example.com
AGENT_SKILL_SOURCE_URL=${manifest.legacySourceUrl}
PORT=8788
`;
const migrated = migrateLegacyAgentSkillEnvironment(legacyEnvironment, manifest);
assert.equal(migrated.changed, true);
assert.match(migrated.content, new RegExp(`AGENT_SKILL_SOURCE_URL=${manifest.sourceUrl}`));
assert.match(migrated.content, new RegExp(`AGENT_SKILL_VERSION=${manifest.version}`));
assert.match(migrated.content, new RegExp(`AGENT_SKILL_REVISION=${manifest.revision}`));
assert.equal(
  migrateLegacyAgentSkillEnvironment(migrated.content, manifest).changed,
  false,
  "The legacy environment migration must be idempotent.",
);
const legacyWithMatchingMetadata = `${legacyEnvironment}AGENT_SKILL_VERSION=${manifest.version}
AGENT_SKILL_REVISION=${manifest.revision}
`;
const matchingMetadataMigration = migrateLegacyAgentSkillEnvironment(
  legacyWithMatchingMetadata,
  manifest,
);
assert.equal(matchingMetadataMigration.changed, true);
assert.equal(
  matchingMetadataMigration.content.match(/^AGENT_SKILL_VERSION=/gm)?.length,
  1,
  "Matching official metadata must not be duplicated.",
);
assert.equal(
  matchingMetadataMigration.content.match(/^AGENT_SKILL_REVISION=/gm)?.length,
  1,
  "Matching official metadata must not be duplicated.",
);
assert.equal(
  migrateLegacyAgentSkillEnvironment(
    "AGENT_SKILL_SOURCE_URL=https://self-hosted.example.com/main\n",
    manifest,
  ).changed,
  false,
  "A custom mutable URL must not be rewritten as an official release.",
);
assert.equal(
  migrateLegacyAgentSkillEnvironment(`${legacyEnvironment}AGENT_SKILL_VERSION=9.0.0\n`, manifest)
    .changed,
  false,
  "Conflicting metadata must be preserved for API validation.",
);

console.log("Ilo setup release manifest contract passed.");
