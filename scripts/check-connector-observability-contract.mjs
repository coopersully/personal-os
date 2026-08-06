import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const checker = resolve(root, ".github/scripts/check-connector-observability.mjs");
const deploy = readFileSync(resolve(root, ".github/workflows/deploy.yml"), "utf8");
const health = readFileSync(resolve(root, ".github/workflows/production-health.yml"), "utf8");
const iam = readFileSync(resolve(root, "infra/iam.tf"), "utf8");
const packageJson = readFileSync(resolve(root, "package.json"), "utf8");

function requireMatch(source, pattern, description) {
  if (!pattern.test(source)) {
    throw new Error(`Connector observability contract is missing ${description}.`);
  }
}

requireMatch(
  deploy,
  /name: Verify connector observability contract[\s\S]*?run: node \.github\/scripts\/check-connector-observability\.mjs[\s\S]*?name: Build and push API and MCP images/,
  "a fail-closed deploy preflight before release publication",
);
requireMatch(
  health,
  /uses: aws-actions\/configure-aws-credentials@[\s\S]*?node \.github\/scripts\/check-connector-observability\.mjs/,
  "the same authenticated check in hourly production health",
);
requireMatch(
  iam,
  /sid\s*=\s*"ReadConnectorMetricFilters"[\s\S]*?actions\s*=\s*\["logs:DescribeMetricFilters"\][\s\S]*?resources\s*=\s*\["arn:aws:logs:\$\{var\.aws_region\}:\$\{data\.aws_caller_identity\.current\.account_id\}:log-group:\/ecs\/\$\{local\.name\}-api:\*"\][\s\S]*?resource\s+"aws_iam_role_policy"\s+"github_connector_observability"/,
  "isolated API-log-group-scoped metric filter authority",
);
requireMatch(
  packageJson,
  /node scripts\/check-connector-observability-contract\.mjs/,
  "deterministic validation in the repository lint gate",
);

const validState = {
  metricFilters: [
    {
      filterName: "personal-os-prod-connector-sync-failure",
      filterPattern: '{ $.event = "connector_sync_failed" }',
      logGroupName: "/ecs/personal-os-prod-api",
      metricTransformations: [
        {
          metricName: "ConnectorSyncFailureCount",
          metricNamespace: "ilo/Connectors",
          metricValue: "1",
        },
      ],
    },
    {
      filterName: "personal-os-prod-connector-configuration-failure",
      filterPattern: '{ $.event = "connector_sync_failed" && $.category = "configuration" }',
      logGroupName: "/ecs/personal-os-prod-api",
      metricTransformations: [
        {
          metricName: "ConnectorConfigurationFailureCount",
          metricNamespace: "ilo/Connectors",
          metricValue: "1",
        },
      ],
    },
  ],
  MetricAlarms: [
    {
      ActionsEnabled: true,
      AlarmActions: ["arn:aws:sns:us-east-1:123456789012:personal-os-prod-operations"],
      AlarmName: "personal-os-prod-connector-configuration-failure",
      ComparisonOperator: "GreaterThanOrEqualToThreshold",
      DatapointsToAlarm: 1,
      EvaluationPeriods: 1,
      MetricName: "ConnectorConfigurationFailureCount",
      Namespace: "ilo/Connectors",
      OKActions: ["arn:aws:sns:us-east-1:123456789012:personal-os-prod-operations"],
      Period: 300,
      Statistic: "Sum",
      Threshold: 1,
      TreatMissingData: "notBreaching",
    },
    {
      ActionsEnabled: true,
      AlarmActions: ["arn:aws:sns:us-east-1:123456789012:personal-os-prod-operations"],
      AlarmName: "personal-os-prod-connector-sync-failure-volume",
      ComparisonOperator: "GreaterThanOrEqualToThreshold",
      DatapointsToAlarm: 1,
      EvaluationPeriods: 1,
      MetricName: "ConnectorSyncFailureCount",
      Namespace: "ilo/Connectors",
      OKActions: ["arn:aws:sns:us-east-1:123456789012:personal-os-prod-operations"],
      Period: 900,
      Statistic: "Sum",
      Threshold: 5,
      TreatMissingData: "notBreaching",
    },
  ],
};

const sandbox = mkdtempSync(resolve(tmpdir(), "ilo-observability-contract-"));
const fakeBin = resolve(sandbox, "bin");
const statePath = resolve(sandbox, "state.json");

try {
  mkdirSync(fakeBin);
  const fakeAws = resolve(fakeBin, "aws");
  writeFileSync(
    fakeAws,
    `#!/usr/bin/env node
import { readFileSync } from "node:fs";
const state = JSON.parse(readFileSync(process.env.FAKE_OBSERVABILITY_STATE, "utf8"));
const operation = process.argv.slice(2, 4).join(" ");
if (state.failOperation === operation) {
  process.stderr.write("RAW_PROVIDER_BODY_SHOULD_NOT_ESCAPE\\n");
  process.exit(254);
}
if (state.hangOperation === operation) {
  setInterval(() => {}, 60_000);
}
if (state.delayAllOperations || state.delayOperation === operation) {
  await new Promise((resolve) => setTimeout(resolve, state.delayMs));
}
if (operation === "logs describe-metric-filters") {
  process.stdout.write(JSON.stringify({ metricFilters: state.metricFilters }));
} else if (operation === "cloudwatch describe-alarms") {
  process.stdout.write(JSON.stringify({ MetricAlarms: state.MetricAlarms }));
} else {
  process.stderr.write("Unexpected AWS operation\\n");
  process.exit(2);
}
`,
  );
  chmodSync(fakeAws, 0o755);

  function run(state) {
    writeFileSync(statePath, JSON.stringify(state));
    return spawnSync("node", [checker], {
      encoding: "utf8",
      timeout: 61_500,
      env: {
        ...process.env,
        ECS_CLUSTER: "personal-os-prod",
        FAKE_OBSERVABILITY_STATE: statePath,
        PATH: `${fakeBin}${delimiter}${process.env.PATH}`,
      },
    });
  }

  const valid = run(validState);
  if (valid.status !== 0 || !valid.stdout.includes("preflight passed")) {
    throw new Error(`Valid connector observability must pass: ${valid.stderr || valid.stdout}`);
  }

  const delayed = run({
    ...validState,
    delayMs: 7_000,
    delayOperation: "logs describe-metric-filters",
  });
  if (delayed.status !== 0 || !delayed.stdout.includes("preflight passed")) {
    throw new Error(
      `A slow but responsive AWS read must remain within the operator budget: ${delayed.stderr || delayed.stdout}`,
    );
  }

  const sequentiallyDelayed = run({
    ...validState,
    delayAllOperations: true,
    delayMs: 16_000,
  });
  if (
    sequentiallyDelayed.status !== 0 ||
    !sequentiallyDelayed.stdout.includes("preflight passed")
  ) {
    throw new Error(
      `Two slow but responsive AWS reads must fit the enclosing harness budget: ${sequentiallyDelayed.stderr || sequentiallyDelayed.stdout}`,
    );
  }

  const invalidStates = [
    {
      label: "missing filter",
      state: { ...validState, metricFilters: validState.metricFilters.slice(1) },
    },
    {
      label: "duplicate filter",
      state: {
        ...validState,
        metricFilters: [...validState.metricFilters, structuredClone(validState.metricFilters[0])],
      },
    },
    {
      label: "drifted filter pattern",
      state: {
        ...validState,
        metricFilters: validState.metricFilters.map((filter, index) =>
          index === 0 ? { ...filter, filterPattern: "raw provider body" } : filter,
        ),
      },
    },
    {
      label: "drifted metric transformation",
      state: {
        ...validState,
        metricFilters: validState.metricFilters.map((filter, index) =>
          index === 0
            ? {
                ...filter,
                metricTransformations: [
                  { ...filter.metricTransformations[0], metricNamespace: "Wrong/Namespace" },
                ],
              }
            : filter,
        ),
      },
    },
    {
      label: "dimensioned metric transformation",
      state: {
        ...validState,
        metricFilters: validState.metricFilters.map((filter, index) =>
          index === 0
            ? {
                ...filter,
                metricTransformations: [
                  { ...filter.metricTransformations[0], dimensions: { Provider: "raw" } },
                ],
              }
            : filter,
        ),
      },
    },
    {
      label: "missing alarm",
      state: { ...validState, MetricAlarms: validState.MetricAlarms.slice(1) },
    },
    {
      label: "duplicate alarm",
      state: {
        ...validState,
        MetricAlarms: [...validState.MetricAlarms, structuredClone(validState.MetricAlarms[0])],
      },
    },
    {
      label: "drifted alarm threshold",
      state: {
        ...validState,
        MetricAlarms: validState.MetricAlarms.map((alarm, index) =>
          index === 0 ? { ...alarm, Threshold: 99 } : alarm,
        ),
      },
    },
    {
      label: "disabled alarm actions",
      state: {
        ...validState,
        MetricAlarms: validState.MetricAlarms.map((alarm, index) =>
          index === 0 ? { ...alarm, ActionsEnabled: false } : alarm,
        ),
      },
    },
    {
      label: "drifted alarm period",
      state: {
        ...validState,
        MetricAlarms: validState.MetricAlarms.map((alarm, index) =>
          index === 0 ? { ...alarm, Period: 60 } : alarm,
        ),
      },
    },
    {
      label: "unsafe missing-data policy",
      state: {
        ...validState,
        MetricAlarms: validState.MetricAlarms.map((alarm, index) =>
          index === 0 ? { ...alarm, TreatMissingData: "missing" } : alarm,
        ),
      },
    },
    {
      label: "missing notification route",
      state: {
        ...validState,
        MetricAlarms: validState.MetricAlarms.map((alarm, index) =>
          index === 0 ? { ...alarm, AlarmActions: [] } : alarm,
        ),
      },
    },
    {
      label: "wrong notification route",
      state: {
        ...validState,
        MetricAlarms: validState.MetricAlarms.map((alarm, index) =>
          index === 0
            ? {
                ...alarm,
                AlarmActions: ["arn:aws:sns:us-east-1:123456789012:unrelated-topic"],
                OKActions: ["arn:aws:sns:us-east-1:123456789012:unrelated-topic"],
              }
            : alarm,
        ),
      },
    },
    {
      label: "AWS read failure",
      state: { ...validState, failOperation: "logs describe-metric-filters" },
    },
    {
      label: "CloudWatch read failure",
      state: { ...validState, failOperation: "cloudwatch describe-alarms" },
    },
    {
      label: "stalled AWS read",
      state: { ...validState, hangOperation: "logs describe-metric-filters" },
    },
  ];

  for (const { label, state } of invalidStates) {
    const result = run(state);
    if (result.status === 0) {
      throw new Error(`${label} must fail connector observability preflight.`);
    }
    if (!result.stderr.includes("Connector observability is not ready")) {
      throw new Error(`${label} must use the safe operator-facing failure.`);
    }
    if (result.stderr.includes("RAW_PROVIDER_BODY_SHOULD_NOT_ESCAPE")) {
      throw new Error(`${label} leaked raw AWS/provider output.`);
    }
  }
} finally {
  rmSync(sandbox, { force: true, recursive: true });
}

console.log("Connector observability deployment contract passed.");
