import { spawnSync } from "node:child_process";

const cluster = process.env.ECS_CLUSTER?.trim();
const failureMessage =
  "Connector observability is not ready. Apply the production Terraform and verify the required filters and alarms.";

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function awsJson(args, resultKey) {
  const result = spawnSync("aws", [...args, "--output", "json"], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    timeout: 30_000,
  });
  if (result.signal !== null || result.status !== 0) fail("aws-read-failed");

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    fail("aws-response-invalid");
  }
  if (!Array.isArray(parsed?.[resultKey])) fail("aws-response-invalid");
  return parsed[resultKey];
}

function exactlyOne(items, predicate, code) {
  const matches = items.filter(predicate);
  if (matches.length !== 1) fail(code);
  return matches[0];
}

function sameValue(actual, expected, code) {
  if (actual !== expected) fail(code);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function validateFilter(filters, expected) {
  const filter = exactlyOne(
    filters,
    ({ filterName }) => filterName === expected.name,
    `filter-count:${expected.name}`,
  );
  sameValue(filter.logGroupName, expected.logGroup, `filter-log-group:${expected.name}`);
  sameValue(filter.filterPattern, expected.pattern, `filter-pattern:${expected.name}`);
  const transformation = exactlyOne(
    filter.metricTransformations ?? [],
    () => true,
    `filter-transformation-count:${expected.name}`,
  );
  sameValue(transformation.metricName, expected.metricName, `filter-metric-name:${expected.name}`);
  sameValue(
    transformation.metricNamespace,
    "ilo/Connectors",
    `filter-metric-namespace:${expected.name}`,
  );
  sameValue(transformation.metricValue, "1", `filter-metric-value:${expected.name}`);
  if (Object.keys(transformation.dimensions ?? {}).length !== 0) {
    fail(`filter-metric-dimensions:${expected.name}`);
  }
  if (transformation.defaultValue != null) fail(`filter-metric-default:${expected.name}`);
}

function validateAlarm(alarms, expected) {
  const alarm = exactlyOne(
    alarms,
    ({ AlarmName }) => AlarmName === expected.name,
    `alarm-count:${expected.name}`,
  );
  for (const [field, value] of Object.entries({
    ActionsEnabled: true,
    ComparisonOperator: "GreaterThanOrEqualToThreshold",
    DatapointsToAlarm: 1,
    EvaluationPeriods: 1,
    MetricName: expected.metricName,
    Namespace: "ilo/Connectors",
    Period: expected.period,
    Statistic: "Sum",
    Threshold: expected.threshold,
    TreatMissingData: "notBreaching",
  })) {
    sameValue(alarm[field], value, `alarm-${field}:${expected.name}`);
  }
  if (!Array.isArray(alarm.AlarmActions) || alarm.AlarmActions.length !== 1) {
    fail(`alarm-actions:${expected.name}`);
  }
  if (!Array.isArray(alarm.OKActions) || alarm.OKActions.length !== 1) {
    fail(`alarm-ok-actions:${expected.name}`);
  }
  sameValue(alarm.OKActions[0], alarm.AlarmActions[0], `alarm-action-route:${expected.name}`);
  if (
    !new RegExp(`^arn:[^:]+:sns:[^:]+:[0-9]{12}:${escapeRegExp(cluster)}-operations$`).test(
      alarm.AlarmActions[0],
    )
  ) {
    fail(`alarm-action-route:${expected.name}`);
  }
  if ((alarm.InsufficientDataActions ?? []).length !== 0) {
    fail(`alarm-insufficient-data-actions:${expected.name}`);
  }
  if ((alarm.Dimensions ?? []).length !== 0) fail(`alarm-dimensions:${expected.name}`);
  if ((alarm.Metrics ?? []).length !== 0) fail(`alarm-metric-math:${expected.name}`);
}

try {
  if (!cluster) fail("cluster-missing");

  const logGroup = `/ecs/${cluster}-api`;
  const filterPrefix = `${cluster}-connector-`;
  const expectedFilters = [
    {
      logGroup,
      metricName: "ConnectorSyncFailureCount",
      name: `${cluster}-connector-sync-failure`,
      pattern: '{ $.event = "connector_sync_failed" }',
    },
    {
      logGroup,
      metricName: "ConnectorConfigurationFailureCount",
      name: `${cluster}-connector-configuration-failure`,
      pattern: '{ $.event = "connector_sync_failed" && $.category = "configuration" }',
    },
  ];
  const expectedAlarms = [
    {
      metricName: "ConnectorConfigurationFailureCount",
      name: `${cluster}-connector-configuration-failure`,
      period: 300,
      threshold: 1,
    },
    {
      metricName: "ConnectorSyncFailureCount",
      name: `${cluster}-connector-sync-failure-volume`,
      period: 900,
      threshold: 5,
    },
  ];

  const filters = awsJson(
    [
      "logs",
      "describe-metric-filters",
      "--log-group-name",
      logGroup,
      "--filter-name-prefix",
      filterPrefix,
    ],
    "metricFilters",
  );
  if (filters.length !== expectedFilters.length) fail("filter-inventory-drifted");
  for (const expected of expectedFilters) validateFilter(filters, expected);

  const alarms = awsJson(
    ["cloudwatch", "describe-alarms", "--alarm-names", ...expectedAlarms.map(({ name }) => name)],
    "MetricAlarms",
  );
  if (alarms.length !== expectedAlarms.length) fail("alarm-inventory-drifted");
  for (const expected of expectedAlarms) validateAlarm(alarms, expected);

  console.log("Connector observability preflight passed.");
} catch (error) {
  const code = typeof error?.code === "string" ? ` (${error.code})` : "";
  process.stderr.write(`${failureMessage}${code}\n`);
  process.exitCode = 1;
}
