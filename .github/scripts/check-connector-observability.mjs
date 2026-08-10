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

function arnSuffix(arn, marker, prefix, code) {
  if (typeof arn !== "string") fail(code);
  const markerIndex = arn.indexOf(marker);
  if (markerIndex < 0) fail(code);
  return `${prefix}${arn.slice(markerIndex + marker.length)}`;
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
  sameValue(
    transformation.metricValue,
    expected.metricValue ?? "1",
    `filter-metric-value:${expected.name}`,
  );
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
    ActionsEnabled: expected.actionsEnabled ?? true,
    ComparisonOperator: expected.comparisonOperator ?? "GreaterThanOrEqualToThreshold",
    DatapointsToAlarm: expected.datapointsToAlarm ?? 1,
    EvaluationPeriods: expected.evaluationPeriods ?? 1,
    MetricName: expected.metricName,
    Namespace: expected.namespace ?? "ilo/Connectors",
    Period: expected.period,
    Statistic: expected.statistic ?? "Sum",
    Threshold: expected.threshold,
    TreatMissingData: expected.treatMissingData ?? "notBreaching",
  })) {
    sameValue(alarm[field], value, `alarm-${field}:${expected.name}`);
  }
  const expectedAlarmActionCount = expected.alarmActionCount ?? 1;
  if (
    !Array.isArray(alarm.AlarmActions) ||
    alarm.AlarmActions.length !== expectedAlarmActionCount
  ) {
    fail(`alarm-actions:${expected.name}`);
  }
  if (!Array.isArray(alarm.OKActions) || alarm.OKActions.length !== 0) {
    fail(`alarm-ok-actions:${expected.name}`);
  }
  if (
    expectedAlarmActionCount === 1 &&
    !new RegExp(`^arn:[^:]+:sns:[^:]+:[0-9]{12}:${escapeRegExp(cluster)}-operations$`).test(
      alarm.AlarmActions[0],
    )
  ) {
    fail(`alarm-action-route:${expected.name}`);
  }
  if ((alarm.InsufficientDataActions ?? []).length !== 0) {
    fail(`alarm-insufficient-data-actions:${expected.name}`);
  }
  const dimensions = Object.fromEntries(
    (alarm.Dimensions ?? [])
      .map(({ Name, Value }) => [Name, Value])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  if (JSON.stringify(dimensions) !== JSON.stringify(expected.dimensions ?? {})) {
    fail(`alarm-dimensions:${expected.name}`);
  }
  if ((alarm.Metrics ?? []).length !== 0) fail(`alarm-metric-math:${expected.name}`);
}

try {
  if (!cluster) fail("cluster-missing");

  const logGroup = `/ecs/${cluster}-api`;
  const filterPrefix = `${cluster}-connector-`;
  const loadBalancer = exactlyOne(
    awsJson(["elbv2", "describe-load-balancers", "--names", `${cluster}-public`], "LoadBalancers"),
    () => true,
    "load-balancer-count",
  );
  const loadBalancerSuffix = arnSuffix(
    loadBalancer.LoadBalancerArn,
    ":loadbalancer/",
    "",
    "load-balancer-arn",
  );
  const targetGroups = awsJson(
    ["elbv2", "describe-target-groups", "--names", `${cluster}-api`, `${cluster}-mcp`],
    "TargetGroups",
  );
  const targetGroupSuffixes = Object.fromEntries(
    ["api", "mcp"].map((service) => {
      const targetGroup = exactlyOne(
        targetGroups,
        ({ TargetGroupName }) => TargetGroupName === `${cluster}-${service}`,
        `target-group-count:${service}`,
      );
      return [
        service,
        arnSuffix(
          targetGroup.TargetGroupArn,
          ":targetgroup/",
          "targetgroup/",
          `target-group-arn:${service}`,
        ),
      ];
    }),
  );
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
    {
      logGroup,
      metricName: "ConnectorSubscriptionFailureCount",
      name: `${cluster}-connector-subscription-failure`,
      pattern: '{ $.event = "connector_subscription_failed" }',
    },
    {
      logGroup,
      metricName: "ConnectorSubscriptionExpiredCount",
      name: `${cluster}-connector-subscription-expired`,
      pattern: '{ $.event = "connector_subscription_expired" }',
    },
    {
      logGroup,
      metricName: "ConnectorRenewalLagMs",
      metricValue: "$.renewalLagMs",
      name: `${cluster}-connector-renewal-lag`,
      pattern: '{ $.event = "connector_subscription_renewed" && $.renewalLagMs = * }',
    },
    {
      logGroup,
      metricName: "ConnectorNotificationRejectedCount",
      name: `${cluster}-connector-notification-rejected`,
      pattern:
        '{ $.event = "connector_notification_received" && $.notificationDisposition = "rejected" }',
    },
    {
      logGroup,
      metricName: "ConnectorTriggerAgeMs",
      metricValue: "$.ageMs",
      name: `${cluster}-connector-trigger-age`,
      pattern: '{ $.event = "connector_trigger_dispatched" && $.ageMs = * }',
    },
    {
      logGroup,
      metricName: "ConnectorSyncFreshnessAgeMs",
      metricValue: "$.freshnessAgeMs",
      name: `${cluster}-connector-sync-freshness-age`,
      pattern: '{ $.event = "connector_sync_freshness_observed" && $.freshnessAgeMs = * }',
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
    {
      metricName: "ConnectorSubscriptionFailureCount",
      name: `${cluster}-connector-subscription-failure`,
      period: 300,
      threshold: 1,
    },
    {
      metricName: "ConnectorSubscriptionExpiredCount",
      name: `${cluster}-connector-subscription-expired`,
      period: 300,
      threshold: 1,
    },
    {
      metricName: "ConnectorRenewalLagMs",
      name: `${cluster}-connector-renewal-lag`,
      period: 300,
      statistic: "Maximum",
      threshold: 300000,
    },
    {
      metricName: "ConnectorNotificationRejectedCount",
      name: `${cluster}-connector-notification-rejected`,
      period: 300,
      threshold: 20,
    },
    {
      metricName: "ConnectorTriggerAgeMs",
      name: `${cluster}-connector-trigger-age`,
      period: 300,
      statistic: "Maximum",
      threshold: 300000,
    },
    {
      datapointsToAlarm: 3,
      evaluationPeriods: 5,
      metricName: "ConnectorSyncFreshnessAgeMs",
      name: `${cluster}-connector-sync-freshness`,
      period: 60,
      statistic: "Maximum",
      threshold: 600000,
      treatMissingData: "breaching",
    },
    ...["api", "mcp"].map((service) => ({
      dimensions: {
        LoadBalancer: loadBalancerSuffix,
        TargetGroup: targetGroupSuffixes[service],
      },
      metricName: "HTTPCode_Target_5XX_Count",
      name: `${cluster}-${service}-target-5xx`,
      namespace: "AWS/ApplicationELB",
      period: 300,
      threshold: 5,
    })),
    {
      actionsEnabled: false,
      alarmActionCount: 0,
      datapointsToAlarm: 2,
      dimensions: { LoadBalancer: loadBalancerSuffix },
      evaluationPeriods: 3,
      metricName: "HTTPCode_ELB_5XX_Count",
      name: `${cluster}-alb-5xx`,
      namespace: "AWS/ApplicationELB",
      period: 300,
      threshold: 5,
    },
    {
      alarmActionCount: 0,
      metricName: "ApiDeploymentInProgress",
      name: `${cluster}-api-deployment-in-progress`,
      namespace: "ilo/Deployments",
      period: 60,
      statistic: "Maximum",
      threshold: 1,
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

  const compositeName = `${cluster}-api-availability-actionable`;
  const composite = exactlyOne(
    awsJson(
      [
        "cloudwatch",
        "describe-alarms",
        "--alarm-names",
        compositeName,
        "--alarm-types",
        "CompositeAlarm",
      ],
      "CompositeAlarms",
    ),
    ({ AlarmName }) => AlarmName === compositeName,
    `composite-count:${compositeName}`,
  );
  for (const [field, value] of Object.entries({
    ActionsEnabled: true,
    AlarmRule: `ALARM("${cluster}-api-public-health") AND NOT ALARM("${cluster}-api-deployment-in-progress")`,
  })) {
    sameValue(composite[field], value, `composite-${field}:${compositeName}`);
  }
  if (!Array.isArray(composite.AlarmActions) || composite.AlarmActions.length !== 1) {
    fail(`composite-actions:${compositeName}`);
  }
  if (
    !new RegExp(`^arn:[^:]+:sns:[^:]+:[0-9]{12}:${escapeRegExp(cluster)}-operations$`).test(
      composite.AlarmActions[0],
    )
  ) {
    fail(`composite-action-route:${compositeName}`);
  }
  if ((composite.OKActions ?? []).length !== 0) fail(`composite-ok-actions:${compositeName}`);
  if ((composite.InsufficientDataActions ?? []).length !== 0) {
    fail(`composite-insufficient-data-actions:${compositeName}`);
  }

  console.log("Connector observability preflight passed.");
} catch (error) {
  const code = typeof error?.code === "string" ? ` (${error.code})` : "";
  process.stderr.write(`${failureMessage}${code}\n`);
  process.exitCode = 1;
}
