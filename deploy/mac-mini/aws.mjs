import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { run } from "./commands.mjs";
import { writePrivate } from "./safety.mjs";

export function serviceDefinition(service) {
  if (
    service?.deployments?.length !== 1 ||
    service.deployments[0].rolloutState !== "COMPLETED" ||
    service.pendingCount !== 0 ||
    !Number.isInteger(service.runningCount) ||
    service.runningCount < 0 ||
    service.runningCount !== service.desiredCount
  )
    throw new Error("Production service must have one completed, stable deployment.");
  return service.taskDefinition;
}

export function projectEnvironment(container, parameters) {
  const output = {};
  for (const { name, value } of container.environment ?? []) {
    if (name in output) throw new Error("Duplicate runtime environment name.");
    output[name] = value;
  }
  for (const { name, valueFrom } of container.secrets ?? []) {
    if (name in output || !valueFrom.includes(":parameter/") || !parameters[valueFrom])
      throw new Error(`Unresolved or duplicate runtime parameter ${name}.`);
    output[name] = parameters[valueFrom];
  }
  return output;
}

export async function inspectAws(profile, outputPath) {
  if (!profile || profile.startsWith("-"))
    throw new Error("Supply the named personal-os AWS profile.");
  if (outputPath && existsSync(outputPath))
    throw new Error("Refusing to overwrite an existing production export.");
  const aws = async (args) =>
    JSON.parse(
      await run("aws", [
        "--profile",
        profile,
        "--region",
        "us-east-1",
        "--output",
        "json",
        ...args,
      ]),
    );
  const identity = await aws(["sts", "get-caller-identity"]);
  if (identity.Account !== "686584420666" || identity.Arn.endsWith(":root"))
    throw new Error("Expected a named non-root operator in the personal-os production account.");
  const response = await aws([
    "ecs",
    "describe-services",
    "--cluster",
    "personal-os-prod",
    "--services",
    "personal-os-prod-api",
    "personal-os-prod-mcp",
  ]);
  if (response.failures?.length || response.services?.length !== 2)
    throw new Error("Cannot resolve both production services.");
  const definitions = {};
  for (const name of ["api", "mcp"]) {
    const service = response.services.find((s) => s.serviceName === `personal-os-prod-${name}`);
    const definition = await aws([
      "ecs",
      "describe-task-definition",
      "--task-definition",
      serviceDefinition(service),
    ]);
    const container = definition.taskDefinition.containerDefinitions.find((c) => c.name === name);
    if (!container) throw new Error("Production container is missing.");
    definitions[name] = container;
  }
  const database = await aws([
    "rds",
    "describe-db-instances",
    "--db-instance-identifier",
    "personal-os-prod-postgres",
  ]);
  const db = database.DBInstances?.[0];
  if (
    db?.PubliclyAccessible !== false ||
    db.DBInstanceStatus !== "available" ||
    db.Engine !== "postgres"
  )
    throw new Error("Expected available private PostgreSQL RDS.");
  if (outputPath) {
    const references = [
      ...new Set(
        Object.values(definitions).flatMap((c) => (c.secrets ?? []).map((s) => s.valueFrom)),
      ),
    ];
    if (references.some((arn) => !arn.startsWith("arn:aws:ssm:us-east-1:686584420666:parameter/")))
      throw new Error("Unexpected secret authority.");
    const parameters = {};
    for (let offset = 0; offset < references.length; offset += 10) {
      const result = await aws([
        "ssm",
        "get-parameters",
        "--with-decryption",
        "--names",
        ...references.slice(offset, offset + 10),
      ]);
      if (result.InvalidParameters?.length)
        throw new Error("Production parameter export is incomplete.");
      for (const entry of result.Parameters ?? []) parameters[entry.ARN] = entry.Value;
    }
    const api = projectEnvironment(definitions.api, parameters),
      mcp = projectEnvironment(definitions.mcp, parameters);
    for (const [key, value] of Object.entries(mcp))
      if (key.startsWith("MCP_") && key !== "MCP_INTERNAL_SECRET") api[key] = value;
    if (api.MCP_INTERNAL_SECRET !== mcp.MCP_INTERNAL_SECRET)
      throw new Error("API and MCP internal credentials disagree.");
    writePrivate(resolve(outputPath), JSON.stringify(api, null, 2));
  }
  return {
    apiImage: definitions.api.image,
    mcpImage: definitions.mcp.image,
    postgresVersion: db.EngineVersion,
    postgresEndpoint: db.Endpoint.Address,
    exported: Boolean(outputPath),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.umask(0o077);
  try {
    process.stdout.write(
      `${JSON.stringify(await inspectAws(process.argv[2], process.argv[3]), null, 2)}\n`,
    );
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
