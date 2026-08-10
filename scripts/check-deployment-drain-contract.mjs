import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const compute = readFileSync(resolve(root, "infra/compute.tf"), "utf8");
const config = readFileSync(resolve(root, "apps/api/src/config.ts"), "utf8");
const iam = readFileSync(resolve(root, "infra/iam.tf"), "utf8");
const main = readFileSync(resolve(root, "apps/api/src/main.ts"), "utf8");
const workflowSource = readFileSync(resolve(root, ".github/workflows/deploy.yml"), "utf8");
const workflow = readFileSync(resolve(root, ".github/scripts/deploy-api.sh"), "utf8");
const runtimeTaskDefinitionCheck = resolve(
  root,
  ".github/scripts/check-runtime-task-definition.mjs",
);
if (
  !/name: Deploy migration-capable API serially[\s\S]*?run: bash \.github\/scripts\/deploy-api\.sh/.test(
    workflowSource,
  )
) {
  throw new Error("Production workflow must remain a thin caller of the checked drain script.");
}
const shellSyntax = spawnSync("bash", ["-n"], { encoding: "utf8", input: workflow });
if (shellSyntax.status !== 0) {
  throw new Error(`Deployment drain shell syntax failed: ${shellSyntax.stderr.trim()}`);
}

function requireMatch(source, pattern, description) {
  if (!pattern.test(source))
    throw new Error(`Deployment drain contract is missing ${description}.`);
}

function requireOrder(earlier, later, description) {
  const earlierIndex = workflow.indexOf(earlier);
  const laterIndex = workflow.lastIndexOf(later);
  if (earlierIndex < 0 || laterIndex < 0 || earlierIndex >= laterIndex) {
    throw new Error(`Deployment drain contract has unsafe ordering: ${description}.`);
  }
}

function checkRuntimeTaskDefinition(taskDefinition) {
  return spawnSync("node", [runtimeTaskDefinitionCheck], {
    encoding: "utf8",
    input: JSON.stringify(taskDefinition),
  });
}

const validRuntimeTaskDefinition = {
  containerDefinitions: [
    {
      name: "api",
      environment: [{ name: "NODE_ENV", value: "production" }],
      secrets: [
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
const validRuntimeCheck = checkRuntimeTaskDefinition(validRuntimeTaskDefinition);
if (validRuntimeCheck.status !== 0) {
  throw new Error(
    `A correctly wired production task definition must pass: ${validRuntimeCheck.stderr.trim()}`,
  );
}
for (const invalidDefinition of [
  {
    ...validRuntimeTaskDefinition,
    containerDefinitions: [
      {
        ...validRuntimeTaskDefinition.containerDefinitions[0],
        environment: [{ name: "GOOGLE_CLIENT_ID", value: "" }],
      },
    ],
  },
  {
    ...validRuntimeTaskDefinition,
    containerDefinitions: [
      {
        ...validRuntimeTaskDefinition.containerDefinitions[0],
        secrets: validRuntimeTaskDefinition.containerDefinitions[0].secrets.filter(
          ({ name }) => name !== "GOOGLE_CLIENT_ID",
        ),
      },
    ],
  },
  {
    ...validRuntimeTaskDefinition,
    containerDefinitions: [
      {
        ...validRuntimeTaskDefinition.containerDefinitions[0],
        secrets: validRuntimeTaskDefinition.containerDefinitions[0].secrets.map((secret) =>
          secret.name === "GOOGLE_CLIENT_SECRET"
            ? { ...secret, valueFrom: "plain-text-is-not-a-runtime-reference" }
            : secret,
        ),
      },
    ],
  },
  {
    ...validRuntimeTaskDefinition,
    containerDefinitions: [
      validRuntimeTaskDefinition.containerDefinitions[0],
      structuredClone(validRuntimeTaskDefinition.containerDefinitions[0]),
    ],
  },
  {
    ...validRuntimeTaskDefinition,
    containerDefinitions: [
      {
        ...validRuntimeTaskDefinition.containerDefinitions[0],
        secrets: [
          ...validRuntimeTaskDefinition.containerDefinitions[0].secrets,
          structuredClone(validRuntimeTaskDefinition.containerDefinitions[0].secrets[0]),
        ],
      },
    ],
  },
  {
    ...validRuntimeTaskDefinition,
    containerDefinitions: [
      {
        ...validRuntimeTaskDefinition.containerDefinitions[0],
        secrets: [
          ...validRuntimeTaskDefinition.containerDefinitions[0].secrets,
          structuredClone(validRuntimeTaskDefinition.containerDefinitions[0].secrets[1]),
        ],
      },
    ],
  },
]) {
  const invalidRuntimeCheck = checkRuntimeTaskDefinition(invalidDefinition);
  if (invalidRuntimeCheck.status === 0) {
    throw new Error("Stale or plain Google runtime wiring must fail deployment preflight.");
  }
  if (!invalidRuntimeCheck.stderr.includes("Google runtime configuration is not ready")) {
    throw new Error("Runtime preflight failures must use the safe operator-facing diagnostic.");
  }
  if (invalidRuntimeCheck.stderr.includes("plain-text-is-not-a-runtime-reference")) {
    throw new Error("Runtime preflight failures must not echo rejected configuration values.");
  }
}

const apiContainerStart = compute.search(/name\s*=\s*"api"/);
const apiContainerEnd = apiContainerStart >= 0 ? compute.indexOf("\n  }])", apiContainerStart) : -1;
const apiContainer =
  apiContainerStart >= 0 && apiContainerEnd >= 0
    ? compute.slice(apiContainerStart, apiContainerEnd)
    : "";
const stopTimeoutSeconds = Number(apiContainer.match(/stopTimeout\s*=\s*(\d+)/)?.[1]);
const shutdownTimeoutMs = Number(
  apiContainer.match(/\{\s*name\s*=\s*"API_SHUTDOWN_TIMEOUT_MS",\s*value\s*=\s*"(\d+)"\s*\}/)?.[1],
);
if (!Number.isFinite(stopTimeoutSeconds) || !Number.isFinite(shutdownTimeoutMs)) {
  throw new Error("Deployment drain contract requires explicit ECS and API shutdown bounds.");
}
if (shutdownTimeoutMs >= stopTimeoutSeconds * 1_000) {
  throw new Error("The API shutdown bound must leave time before ECS force-stops the container.");
}

requireMatch(
  config,
  /API_SHUTDOWN_TIMEOUT_MS:[\s\S]*?max\(110_000\)[\s\S]*?default\(105_000\)/,
  "a validated API shutdown timeout below the ECS stop timeout",
);
requireMatch(
  iam,
  /sid\s*=\s*"ObserveScalingStateForDrainRestore"[\s\S]*?actions\s*=\s*\["application-autoscaling:DescribeScalableTargets"\][\s\S]*?resources\s*=\s*\["\*"\]/,
  "the isolated scaling-state observation bootstrap required by the workflow",
);
requireMatch(
  iam,
  /sid\s*=\s*"PublishDeploymentHeartbeat"[\s\S]*?actions\s*=\s*\["cloudwatch:PutMetricData"\][\s\S]*?cloudwatch:namespace[\s\S]*?ilo\/Deployments/,
  "namespace-scoped deployment heartbeat authority",
);
requireMatch(
  main,
  /shutdownApiRuntime\(\{[\s\S]*?timeoutMs:\s*config\.apiShutdownTimeoutMs/,
  "bounded shutdown orchestration",
);
requireMatch(
  main,
  /runtimeLifecycle\.startBackgroundTask\("scheduled-automation-dispatch"/,
  "tracked scheduler work",
);
requireMatch(
  workflow,
  /api_stopped_preflight_details=[\s\S]*?api_proven_stopped_before=[\s\S]*?api_active_stopping_before=[\s\S]*?api_stopped_inventory_stable=[\s\S]*?api_drain_task_arns=/,
  "complete task capture across running, stopping, replacement, and drain states",
);
if (workflow.includes("--desired-status PENDING")) {
  throw new Error(
    "Deployment drain contract must not use ECS desired-status PENDING; desired RUNNING includes lastStatus PENDING.",
  );
}
requireMatch(
  workflow,
  /desiredStatus is only RUNNING or STOPPED[\s\S]*?--desired-status RUNNING[\s\S]*?api_suspended_running/,
  "the documented desired-RUNNING/last-PENDING completeness check",
);
requireMatch(
  workflow,
  /--desired-status STOPPED[\s\S]*?--max-items 101[\s\S]*?post-suspension STOPPED task baseline exceeds/,
  "a fail-fast 100-task bound before baseline description",
);
requireMatch(
  workflow,
  /for reconciliation_delay in 1 2 4 8 16 32 32 32 32 32 32 32 32 32[\s\S]*?api_stopped_inventory_attempt" -ge 14[\s\S]*?api_stopped_inventory_stable[\s\S]*?did not converge/,
  "five-minute eventual-consistency reconciliation to a stable stopped-task inventory",
);
requireMatch(
  workflow,
  /aws ecs describe-tasks[\s\S]*?\.exitCode == 0[\s\S]*?test\("kill\|timeout"; "i"\)/,
  "successful stopped-container evidence without timeout or SIGKILL",
);
requireMatch(
  workflow,
  /fail_closed_api_deployment\(\)[\s\S]*?trap - ERR EXIT[\s\S]*?run_interruptible aws application-autoscaling register-scalable-target[\s\S]*?--suspended-state "\$api_all_suspended_state"[\s\S]*?run_interruptible aws ecs update-service[\s\S]*?--desired-count 0[\s\S]*?capture_interruptible aws ecs describe-services[\s\S]*?desiredCount,runningCount,pendingCount/,
  "post-drain scaling re-suspension plus zero-state recovery and verification",
);
requireMatch(
  workflow,
  /publish_api_deployment_state\(\)[\s\S]*?cloudwatch put-metric-data[\s\S]*?--namespace ilo\/Deployments[\s\S]*?ApiDeploymentInProgress/,
  "an aggregate CloudWatch deployment-state publisher",
);
requireMatch(
  workflow,
  /api_deployment_heartbeat_interval_seconds="\$\{API_DEPLOYMENT_HEARTBEAT_INTERVAL_SECONDS:-30\}"[\s\S]*?start_api_deployment_heartbeat\(\)[\s\S]*?publish_api_deployment_state 1[\s\S]*?\/bin\/sleep "\$api_deployment_heartbeat_interval_seconds"[\s\S]*?for heartbeat_attempt in 1 2 3[\s\S]*?publish_api_deployment_state 1/,
  "a default-thirty-second deployment heartbeat loop with bounded refresh retries",
);
requireMatch(
  workflow,
  /assert_api_deployment_heartbeat_healthy\(\)[\s\S]*?api_deployment_heartbeat_failure_file[\s\S]*?kill -0[\s\S]*?# Stop and drain the old binary[\s\S]*?start_api_deployment_heartbeat[\s\S]*?assert_api_deployment_heartbeat_healthy[\s\S]*?api_rollout_complete=true/,
  "parent-visible heartbeat failure checks throughout the rollout",
);
requireMatch(
  workflow,
  /stop_api_deployment_heartbeat\(\)[\s\S]*?publish_api_deployment_state 0/,
  "deployment heartbeat cleanup that restores incident paging",
);
requireMatch(
  workflow,
  /# Stop and drain the old binary[\s\S]*?start_api_deployment_heartbeat[\s\S]*?api_service_drain_attempted=true[\s\S]*?--desired-count 0/,
  "deployment heartbeat proof before the availability-changing API drain",
);
requireMatch(
  workflow,
  /test "\$api_minimum_healthy_percent" = "0"[\s\S]*?test "\$api_maximum_percent" = "200"/,
  "live deployment percentages matching the declared IaC configuration",
);
requireMatch(
  workflow,
  /run_interruptible aws ecs wait tasks-stopped[\s\S]*?aws ecs describe-tasks/,
  "exact stopped-task propagation before exit evidence inspection",
);
requireMatch(
  workflow,
  /if test "\$api_recovery_entry" = "true"; then[\s\S]*?current_scaling_suspension[\s\S]*?else[\s\S]*?register-scalable-target[\s\S]*?fi[\s\S]*?if test "\$api_recovery_entry" != "true"; then[\s\S]*?aws ecs wait services-stable[\s\S]*?fi[\s\S]*?api_suspended_service_state=/,
  "read-only recovery suspension verification without a retained-failed-deployment stability wait",
);
requireMatch(
  workflow,
  /api_suspended_desired=[\s\S]*?desiredCount[\s\S]*?api_suspended_running=[\s\S]*?runningCount[\s\S]*?api_suspended_pending=[\s\S]*?pendingCount[\s\S]*?test "\$api_recovery_entry" = "true"[\s\S]*?test "\$api_suspended_desired" = "0"[\s\S]*?test "\$api_suspended_running" = "0"[\s\S]*?test "\$api_suspended_pending" = "0"/,
  "a second exact zero-state proof immediately before a recovery candidate can launch",
);
requireMatch(
  workflow,
  /api_service_drain_attempted=true[\s\S]*?if test "\$api_recovery_entry" != "true"; then[\s\S]*?aws ecs update-service[\s\S]*?--desired-count 0[\s\S]*?aws ecs wait services-stable[\s\S]*?fi[\s\S]*?api_counts=/,
  "direct zero-state verification during failed-deployment recovery without an unsatisfiable generic stability wait",
);
requireMatch(
  workflow,
  /aws ecs wait services-stable[\s\S]*?for api_primary_completion_delay in 0 1 2 4 8 16 30 30 30 30[\s\S]*?api_primary_rollout[\s\S]*?IN_PROGRESS[\s\S]*?api_primary_completed/,
  "bounded exact-primary completion after the ECS stable-count waiter",
);
requireMatch(
  workflow,
  /trap cleanup_api_deployment EXIT[\s\S]*?trap 'cancel_api_deployment 130' INT[\s\S]*?trap 'cancel_api_deployment 143' TERM/,
  "fail-closed cancellation and process-exit cleanup",
);
requireMatch(
  workflow,
  /cancel_api_deployment\(\)[\s\S]*?AWS_MAX_ATTEMPTS=1 aws application-autoscaling register-scalable-target[\s\S]*?--cli-read-timeout 2[\s\S]*?AWS_MAX_ATTEMPTS=1 aws ecs update-service[\s\S]*?--cli-read-timeout 2/,
  "single-attempt cancellation mutations within the runner signal grace window",
);
requireMatch(
  workflow,
  /api_proven_stopped_before=[\s\S]*?api_suspension_attempted=true[\s\S]*?run_interruptible aws application-autoscaling register-scalable-target[\s\S]*?api_stopped_before_drain=[\s\S]*?api_service_drain_attempted=true[\s\S]*?run_interruptible aws ecs update-service[\s\S]*?--desired-count 0/,
  "separate suspension-attempt and service-drain mutation phases",
);
requireMatch(
  workflow,
  /run_interruptible\(\)[\s\S]*?api_active_child_pid="pending"[\s\S]*?wait "\$api_active_child_pid"[\s\S]*?capture_interruptible\(\)[\s\S]*?cancel_api_deployment\(\)[\s\S]*?jobs -pr[\s\S]*?kill -TERM "\$api_active_child_pid"/,
  "prompt cancellation of foreground waits before fail-closed recovery",
);
requireMatch(
  workflow,
  /elif \{[\s\S]*?api_suspension_attempted[\s\S]*?--suspended-state "\$api_original_suspended_state"[\s\S]*?fi/,
  "pre-drain failure restoration without stopping the healthy old service",
);
requireMatch(
  workflow,
  /current_scaling_suspension[\s\S]*?api_original_suspended_state="\$api_scaling_suspension"[\s\S]*?--suspended-state "\$api_original_suspended_state"[\s\S]*?current_scaling_suspension/,
  "exact scalable-target suspension capture, restore, and verification",
);
requireMatch(
  workflow,
  /task_definition_has_shutdown_contract[\s\S]*?stopTimeout == 120[\s\S]*?API_SHUTDOWN_TIMEOUT_MS[\s\S]*?105000[\s\S]*?api_gate_running_arns[\s\S]*?imageDigest[\s\S]*?unique \| length\) == 1[\s\S]*?\.taskDefinitionArn == \$definition[\s\S]*?\.image == \$image[\s\S]*?\/health\/ready[\s\S]*?quiesce-v1/,
  "a pre-mutation exact-task and live-readiness lifecycle bootstrap gate",
);
requireMatch(
  workflowSource,
  /ILO_DEPLOYMENT_RESTORE_STATE[\s\S]*?ILO_DEPLOYMENT_RECOVERY_MARKER[\s\S]*?api_is_emergency[\s\S]*?failedTaskDefinitionArn[\s\S]*?postDrainTaskDefinitionArns[\s\S]*?recoveryAuthorized = true[\s\S]*?api_candidate_recovery_marker[\s\S]*?register_task \\\n {12}"\$MCP_SERVICE"[\s\S]*?register_task \\\n {12}"\$API_SERVICE"/,
  "explicit marker-gated bounded recovery-intent inheritance",
);
requireMatch(
  workflowSource,
  /api_latest_definition="\$\([\s\S]*?describe-task-definition[\s\S]*?\)"[\s\S]*?api_latest_definition_arn="\$\([\s\S]*?\.taskDefinitionArn[\s\S]*?\)"[\s\S]*?node \.github\/scripts\/check-runtime-task-definition\.mjs <<<"\$api_latest_definition"[\s\S]*?register_task \\\n+ {12}"\$API_SERVICE" \\\n+ {12}api[\s\S]*?api_task_definition \\\n+ {12}"\$api_latest_definition_arn"/,
  "Google runtime wiring validation bound to the exact API revision later cloned",
);
requireMatch(
  workflow,
  /persist_failed_rollout_marker[\s\S]*?ILO_DEPLOYMENT_RECOVERY_MARKER[\s\S]*?register-task-definition[\s\S]*?clear_successful_recovery_marker[\s\S]*?ILO_DEPLOYMENT_RECOVERY_MARKER[\s\S]*?api_recovery_authorized[\s\S]*?api_recovery_entry=true[\s\S]*?postDrainDefinitions[\s\S]*?index\(\$definition\)[\s\S]*?api_original_suspended_state="\$api_restore_suspended_state"[\s\S]*?--task-definition "\$API_TASK_DEFINITION"[\s\S]*?--desired-count 1[\s\S]*?clear_successful_recovery_marker/,
  "explicit zero/all-suspended retry recovery to persisted desired and scaling intent",
);

requireOrder(
  '--deployment-configuration "$api_breaker_disabled_configuration"',
  '--task-definition "$API_TASK_DEFINITION"',
  "circuit-breaker rollback must be disabled before the migration-capable task starts",
);
requireOrder(
  'test "$api_primary_rollout" = "COMPLETED"',
  '--deployment-configuration "$api_iac_deployment_configuration"',
  "IaC rollback configuration must be restored only after exact-primary health verification",
);
requireOrder(
  '--deployment-configuration "$api_iac_deployment_configuration"',
  '--suspended-state "$api_original_suspended_state"',
  "scaling must remain suspended until the circuit-breaker configuration is restored",
);

console.log("Deployment drain, shutdown, and rollback contract passed.");
