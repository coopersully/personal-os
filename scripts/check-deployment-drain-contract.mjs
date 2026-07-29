import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const compute = readFileSync(resolve(root, "infra/compute.tf"), "utf8");
const config = readFileSync(resolve(root, "apps/api/src/config.ts"), "utf8");
const main = readFileSync(resolve(root, "apps/api/src/main.ts"), "utf8");
const workflow = readFileSync(resolve(root, ".github/workflows/deploy.yml"), "utf8");

function requireMatch(source, pattern, description) {
  if (!pattern.test(source))
    throw new Error(`Deployment drain contract is missing ${description}.`);
}

function requireOrder(earlier, later, description) {
  const earlierIndex = workflow.indexOf(earlier);
  const laterIndex = workflow.indexOf(later);
  if (earlierIndex < 0 || laterIndex < 0 || earlierIndex >= laterIndex) {
    throw new Error(`Deployment drain contract has unsafe ordering: ${description}.`);
  }
}

const stopTimeoutSeconds = Number(
  compute.match(/name\s*=\s*"api"[\s\S]*?stopTimeout\s*=\s*(\d+)/)?.[1],
);
const shutdownTimeoutMs = Number(
  compute.match(/\{\s*name\s*=\s*"API_SHUTDOWN_TIMEOUT_MS",\s*value\s*=\s*"(\d+)"\s*\}/)?.[1],
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
  /aws ecs list-tasks[\s\S]*?api_pre_drain_task_arns=/,
  "ListTasks authority preflight and exact task capture",
);
requireMatch(
  workflow,
  /aws ecs describe-tasks[\s\S]*?\.exitCode == 0[\s\S]*?test\("kill\|timeout"; "i"\)/,
  "successful stopped-container evidence without timeout or SIGKILL",
);
requireMatch(
  workflow,
  /fail_closed_api_deployment\(\)[\s\S]*?--desired-count 0[\s\S]*?desiredCount,runningCount,pendingCount/,
  "post-drain zero-state recovery and verification",
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
  "DynamicScalingInSuspended=false",
  "scaling must remain suspended until the circuit-breaker configuration is restored",
);

console.log("Deployment drain, shutdown, and rollback contract passed.");
