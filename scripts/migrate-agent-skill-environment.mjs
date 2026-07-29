import { chmodSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function migrateLegacyAgentSkillEnvironment(content, manifest) {
  const lines = content.split(/\r?\n/);
  const sourceLine = `AGENT_SKILL_SOURCE_URL=${manifest.legacySourceUrl}`;
  if (!lines.includes(sourceLine)) return { changed: false, content };
  const versionLine = lines.find((line) => line.startsWith("AGENT_SKILL_VERSION="));
  const revisionLine = lines.find((line) => line.startsWith("AGENT_SKILL_REVISION="));
  if (
    (versionLine && versionLine !== `AGENT_SKILL_VERSION=${manifest.version}`) ||
    (revisionLine && revisionLine !== `AGENT_SKILL_REVISION=${manifest.revision}`)
  ) {
    return { changed: false, content };
  }
  const migrated = lines.map((line) =>
    line === sourceLine ? `AGENT_SKILL_SOURCE_URL=${manifest.sourceUrl}` : line,
  );
  const insertion = migrated.at(-1) === "" ? migrated.length - 1 : migrated.length;
  const missingMetadata = [
    ...(versionLine ? [] : [`AGENT_SKILL_VERSION=${manifest.version}`]),
    ...(revisionLine ? [] : [`AGENT_SKILL_REVISION=${manifest.revision}`]),
  ];
  migrated.splice(insertion, 0, ...missingMetadata);
  return { changed: true, content: migrated.join("\n") };
}

function migrateFile(environmentPath, manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const original = readFileSync(environmentPath, "utf8");
  const migrated = migrateLegacyAgentSkillEnvironment(original, manifest);
  if (!migrated.changed) return false;
  const temporary = resolve(
    dirname(environmentPath),
    `.env.agent-skill-migration.${process.pid}.tmp`,
  );
  writeFileSync(temporary, migrated.content, { mode: statSync(environmentPath).mode });
  chmodSync(temporary, statSync(environmentPath).mode);
  renameSync(temporary, environmentPath);
  return true;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const [environmentPath, manifestPath] = process.argv.slice(2);
  if (!environmentPath || !manifestPath) {
    throw new Error("Usage: migrate-agent-skill-environment.mjs <environment> <manifest>");
  }
  if (migrateFile(environmentPath, manifestPath)) {
    console.log("Migrated the legacy official agent-skill environment to its immutable release.");
  }
}
