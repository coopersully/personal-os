import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const runtimeTaskDefinitionCheck = resolve(
  import.meta.dirname,
  "../.github/scripts/check-runtime-task-definition.mjs",
);
const safeFailure = "Plaid production runtime configuration is not ready";

const validPlaid = {
  containerDefinitions: [
    {
      name: "api",
      environment: [{ name: "PLAID_ENV", value: "production" }],
      secrets: [
        {
          name: "PLAID_CLIENT_ID",
          valueFrom:
            "arn:aws:ssm:us-east-1:123456789012:parameter/personal-os/prod/PLAID_CLIENT_ID",
        },
        {
          name: "PLAID_SECRET",
          valueFrom: "arn:aws:ssm:us-east-1:123456789012:parameter/personal-os/prod/PLAID_SECRET",
        },
      ],
    },
  ],
};

const validProduction = {
  containerDefinitions: [
    {
      ...validPlaid.containerDefinitions[0],
      secrets: [
        ...validPlaid.containerDefinitions[0].secrets,
        {
          name: "GOOGLE_CLIENT_ID",
          valueFrom:
            "arn:aws:ssm:us-east-1:123456789012:parameter/personal-os/prod/GOOGLE_CLIENT_ID",
        },
        {
          name: "GOOGLE_CLIENT_SECRET",
          valueFrom:
            "arn:aws:ssm:us-east-1:123456789012:parameter/personal-os/prod/GOOGLE_CLIENT_SECRET",
        },
      ],
    },
  ],
};

function check(taskDefinition) {
  return spawnSync("node", [runtimeTaskDefinitionCheck], {
    encoding: "utf8",
    input: JSON.stringify(taskDefinition),
  });
}

const valid = check(validProduction);
if (valid.status !== 0) {
  throw new Error(`A production Plaid task definition must pass: ${valid.stderr.trim()}`);
}

for (const invalidTaskDefinition of [
  {
    ...validProduction,
    containerDefinitions: [
      {
        ...validProduction.containerDefinitions[0],
        environment: [{ name: "PLAID_ENV", value: "sandbox" }],
      },
    ],
  },
  {
    ...validProduction,
    containerDefinitions: [
      {
        ...validProduction.containerDefinitions[0],
        secrets: validProduction.containerDefinitions[0].secrets.filter(
          ({ name }) => name !== "PLAID_SECRET",
        ),
      },
    ],
  },
]) {
  const invalid = check(invalidTaskDefinition);
  if (invalid.status === 0) {
    throw new Error("Sandbox or incomplete Plaid runtime wiring must fail deployment preflight.");
  }
  if (!invalid.stderr.includes(safeFailure)) {
    throw new Error(
      "Plaid runtime preflight failures must use the safe operator-facing diagnostic.",
    );
  }
}
