import { readFileSync } from "node:fs";

const googleSafeFailure =
  "::error::Google runtime configuration is not ready. Apply the production Terraform configuration so GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are ECS secret references, then retry; no API tasks were drained.\n";
const plaidSafeFailure =
  "::error::Plaid production runtime configuration is not ready. Apply the production Terraform configuration so PLAID_ENV is production and PLAID_CLIENT_ID and PLAID_SECRET are ECS secret references, then retry; no API tasks were drained.\n";

function failClosed(safeFailure) {
  process.stderr.write(safeFailure);
  process.exit(1);
}

let taskDefinition;
try {
  taskDefinition = JSON.parse(readFileSync(0, "utf8"));
} catch {
  failClosed(googleSafeFailure);
}

if (!taskDefinition || !Array.isArray(taskDefinition.containerDefinitions)) {
  failClosed(googleSafeFailure);
}

const apiContainers = taskDefinition.containerDefinitions.filter(
  (container) => container && container.name === "api",
);
if (apiContainers.length !== 1) failClosed(googleSafeFailure);

const api = apiContainers[0];
const environment = Array.isArray(api.environment) ? api.environment : [];
const secrets = Array.isArray(api.secrets) ? api.secrets : [];

if (environment.some((entry) => entry?.name === "GOOGLE_CLIENT_ID")) {
  failClosed(googleSafeFailure);
}

for (const name of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]) {
  const matchingSecrets = secrets.filter((entry) => entry?.name === name);
  if (matchingSecrets.length !== 1) failClosed(googleSafeFailure);

  const valueFrom = matchingSecrets[0]?.valueFrom;
  const expectedReference = new RegExp(`^arn:[^:]+:ssm:[^:]+:[0-9]{12}:parameter/.+/${name}$`);
  if (typeof valueFrom !== "string" || !expectedReference.test(valueFrom)) {
    failClosed(googleSafeFailure);
  }
}

const plaidSecretNames = ["PLAID_CLIENT_ID", "PLAID_SECRET"];
if (secrets.some((entry) => plaidSecretNames.includes(entry?.name))) {
  const plaidEnvironment = environment.filter((entry) => entry?.name === "PLAID_ENV");
  if (plaidEnvironment.length !== 1 || plaidEnvironment[0]?.value !== "production") {
    failClosed(plaidSafeFailure);
  }

  for (const name of plaidSecretNames) {
    const matchingSecrets = secrets.filter((entry) => entry?.name === name);
    if (matchingSecrets.length !== 1) failClosed(plaidSafeFailure);

    const valueFrom = matchingSecrets[0]?.valueFrom;
    const expectedReference = new RegExp(`^arn:[^:]+:ssm:[^:]+:[0-9]{12}:parameter/.+/${name}$`);
    if (typeof valueFrom !== "string" || !expectedReference.test(valueFrom)) {
      failClosed(plaidSafeFailure);
    }
  }
}
