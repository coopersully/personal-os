import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const deployScript = resolve(root, ".github/scripts/deploy-api.sh");

function readState(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeState(path, state) {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(state)}\n`);
  renameSync(temporaryPath, path);
}

function argument(args, name) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

function logCall(state, words) {
  state.calls.push(words.join(" "));
}

function fakeAws(args) {
  const statePath = process.env.FAKE_AWS_STATE;
  if (!statePath) throw new Error("FAKE_AWS_STATE is required.");
  const state = readState(statePath);
  const [service, operation] = args;
  logCall(state, args);

  if (service === "cloudwatch" && operation === "put-metric-data") {
    const metricData = argument(args, "--metric-data") ?? "";
    const value = Number(metricData.match(/(?:^|,)Value=([^,]+)/)?.[1]);
    if (!Number.isFinite(value)) throw new Error("Expected deployment metric value.");
    if (process.env.FAKE_HEARTBEAT_LOG) {
      appendFileSync(process.env.FAKE_HEARTBEAT_LOG, `${value}\n`);
    }
    if (process.env.ILO_DEPLOYMENT_HEARTBEAT_WORKER === "true") {
      const heartbeatAttempts = readFileSync(process.env.FAKE_HEARTBEAT_LOG, "utf8")
        .trim()
        .split("\n")
        .filter((entry) => Number(entry) === 1).length;
      if (
        Number.isInteger(state.failDeploymentMetricAfter) &&
        heartbeatAttempts > state.failDeploymentMetricAfter
      ) {
        process.stderr.write("Deployment heartbeat unavailable\n");
        process.exitCode = 254;
      }
      return;
    }
    state.deploymentMetricAttempts += 1;
    if (
      value === 1 &&
      Number.isInteger(state.failDeploymentMetricAfter) &&
      state.deploymentMetricAttempts > state.failDeploymentMetricAfter
    ) {
      writeState(statePath, state);
      process.stderr.write("Deployment heartbeat unavailable\n");
      process.exitCode = 254;
      return;
    }
    state.deploymentMetricValues.push(value);
    if (value === 1) {
      state.deploymentZeroPublishes = 0;
    }
    if (value === 0) {
      state.deploymentZeroPublishes += 1;
    }
    const zeroHasCleared =
      value !== 0 || state.deploymentZeroPublishes >= (state.requiredDeploymentZeroPublishes ?? 1);
    if (!(value === 0 && state.stickyDeploymentAlarm === true) && zeroHasCleared) {
      state.deploymentAlarmState = value >= 1 ? "ALARM" : "OK";
    }
    writeState(statePath, state);
    return;
  }

  if (service === "cloudwatch" && operation === "describe-alarms") {
    writeState(statePath, state);
    process.stdout.write(`${state.deploymentAlarmState}\n`);
    return;
  }

  if (service === "ecs" && operation === "describe-task-definition") {
    const taskDefinition = argument(args, "--task-definition");
    const definition = state.taskDefinitions[taskDefinition];
    writeState(statePath, state);
    if (!definition) throw new Error(`Missing fake task definition ${taskDefinition}.`);
    process.stdout.write(JSON.stringify(definition));
    return;
  }

  if (service === "ecs" && operation === "register-task-definition") {
    const input = argument(args, "--cli-input-json");
    if (!input?.startsWith("file://")) throw new Error("Expected file task definition input.");
    const definition = JSON.parse(readFileSync(input.slice("file://".length), "utf8"));
    state.registerTaskDefinitionCalls += 1;
    const taskDefinitionArn = `recovery-marker-definition-${state.registerTaskDefinitionCalls}`;
    const registered = { ...definition, taskDefinitionArn };
    state.taskDefinitions[taskDefinitionArn] = registered;
    state.latestTaskDefinition = taskDefinitionArn;
    writeState(statePath, state);
    process.stdout.write(JSON.stringify(registered));
    return;
  }

  if (service === "application-autoscaling" && operation === "describe-scalable-targets") {
    state.describeScalingCalls += 1;
    writeState(statePath, state);
    if (state.failDescribeScalingAt === state.describeScalingCalls) {
      process.stderr.write("Scaling state unavailable\n");
      process.exitCode = 254;
      return;
    }
    process.stdout.write(
      JSON.stringify({ ScalableTargets: [{ SuspendedState: state.suspension }] }),
    );
    return;
  }

  if (service === "application-autoscaling" && operation === "register-scalable-target") {
    if (state.denyRegister) {
      writeState(statePath, state);
      process.stderr.write("AccessDenied\n");
      process.exitCode = 254;
      return;
    }
    if (
      state.cancelDuringRecoveryRegister &&
      state.primaryTaskDefinition === "new-task-definition" &&
      !state.recoveryRegisterCancelled
    ) {
      state.recoveryRegisterCancelled = true;
      state.cancellationSignalAt = Date.now();
      writeState(statePath, state);
      process.kill(process.ppid, "SIGTERM");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10_000);
    }
    state.suspension = JSON.parse(argument(args, "--suspended-state") ?? "{}");
    writeState(statePath, state);
    return;
  }

  if (service === "ecs" && operation === "list-tasks") {
    const desiredStatus = argument(args, "--desired-status");
    if (desiredStatus === "RUNNING") {
      writeState(statePath, state);
      process.stdout.write(JSON.stringify(state.runningInventory));
      return;
    }
    if (desiredStatus === "STOPPED") {
      const index = state.stoppedListCalls;
      state.stoppedListCalls += 1;
      const taskUpdates = state.stoppedTaskUpdates?.[index] ?? {};
      for (const [taskArn, update] of Object.entries(taskUpdates)) {
        state.tasks[taskArn] = { ...state.tasks[taskArn], ...update };
      }
      const inventory =
        state.stoppedInventories[Math.min(index, state.stoppedInventories.length - 1)];
      writeState(statePath, state);
      process.stdout.write(JSON.stringify(inventory));
      return;
    }
  }

  if (service === "ecs" && operation === "describe-tasks") {
    const start = args.indexOf("--tasks") + 1;
    const taskArns = [];
    for (let index = start; index < args.length && !args[index].startsWith("--"); index += 1) {
      taskArns.push(args[index]);
    }
    const tasks = taskArns.map((taskArn) => {
      const task = state.tasks[taskArn];
      if (!task) throw new Error(`Missing fake task ${taskArn}.`);
      const isRunning = state.desiredCount > 0 && state.runningInventory.includes(taskArn);
      const taskDefinitionArn = task.taskDefinitionArn ?? "old-task-definition";
      return {
        containers: [
          {
            exitCode: isRunning ? undefined : task.exitCode,
            image:
              task.image ?? state.taskDefinitions[taskDefinitionArn].containerDefinitions[0].image,
            imageDigest: task.imageDigest ?? "sha256:api-stable",
            lastStatus: isRunning ? "RUNNING" : task.lastStatus,
            name: "api",
            reason: task.reason ?? "",
          },
        ],
        lastStatus: isRunning ? "RUNNING" : task.lastStatus,
        stoppedAt: isRunning ? undefined : task.stoppedAt,
        stoppedReason: task.stoppedReason ?? "",
        taskArn,
        taskDefinitionArn,
      };
    });
    writeState(statePath, state);
    process.stdout.write(JSON.stringify({ failures: [], tasks }));
    return;
  }

  if (service === "ecs" && operation === "describe-services") {
    const query = argument(args, "--query") ?? "";
    if (
      state.cancelDuringPostLaunchRead &&
      state.primaryTaskDefinition === "new-task-definition" &&
      !state.postLaunchReadCancelled
    ) {
      state.postLaunchReadCancelled = true;
      state.cancellationSignalAt = Date.now();
      writeState(statePath, state);
      process.kill(process.ppid, "SIGINT");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10_000);
    }
    if (
      state.failPostLaunchRead &&
      state.primaryTaskDefinition === "new-task-definition" &&
      !state.postLaunchReadFailed
    ) {
      state.postLaunchReadFailed = true;
      writeState(statePath, state);
      process.stderr.write("Post-launch read failed\n");
      process.exitCode = 255;
      return;
    }
    let primaryRolloutState = "COMPLETED";
    if (
      query.length === 0 &&
      state.primaryRolloutStates?.length > 0 &&
      state.primaryTaskDefinition !== "old-task-definition"
    ) {
      primaryRolloutState = state.primaryRolloutStates.shift();
    }
    writeState(statePath, state);
    if (query.includes("desiredCount,runningCount,pendingCount")) {
      process.stdout.write(`${state.desiredCount}\t${state.runningCount}\t${state.pendingCount}\n`);
      return;
    }
    if (query.includes("deploymentCircuitBreaker")) {
      process.stdout.write(
        `${state.breaker.enable ? "True" : "False"}\t${state.breaker.rollback ? "True" : "False"}\n`,
      );
      return;
    }
    process.stdout.write(
      JSON.stringify({
        services: [
          {
            deploymentConfiguration: {
              deploymentCircuitBreaker: state.breaker,
              maximumPercent: 200,
              minimumHealthyPercent: 0,
            },
            deployments: [
              {
                rolloutState: primaryRolloutState,
                status: "PRIMARY",
                taskDefinition: state.primaryTaskDefinition,
              },
            ],
            desiredCount: state.desiredCount,
            pendingCount: state.pendingCount,
            runningCount: state.runningCount,
          },
        ],
      }),
    );
    return;
  }

  if (service === "ecs" && operation === "update-service") {
    const deploymentConfiguration = argument(args, "--deployment-configuration");
    if (deploymentConfiguration) {
      state.breaker = JSON.parse(deploymentConfiguration).deploymentCircuitBreaker;
    }
    const desiredCount = argument(args, "--desired-count");
    if (desiredCount !== undefined) {
      state.desiredCount = Number(desiredCount);
      state.pendingCount = 0;
      state.runningCount = Number(desiredCount);
      if (desiredCount === "0") {
        state.zeroCalls += 1;
      }
    }
    const taskDefinition = argument(args, "--task-definition");
    if (taskDefinition) {
      state.primaryTaskDefinition = taskDefinition;
      for (const taskArn of state.runningInventory) {
        state.tasks[taskArn].taskDefinitionArn = taskDefinition;
      }
    }
    writeState(statePath, state);
    return;
  }

  if (service === "ecs" && operation === "wait") {
    state.serviceWaitCalls += 1;
    writeState(statePath, state);
    if (state.failFirstServiceWait && state.serviceWaitCalls === 1) {
      process.stderr.write("Wait failed\n");
      process.exitCode = 255;
      return;
    }
    if (
      state.cancelDuringPostZeroWait &&
      state.desiredCount === 0 &&
      !state.postZeroWaitCancelled
    ) {
      state.postZeroWaitCancelled = true;
      state.cancellationSignalAt = Date.now();
      writeState(statePath, state);
      process.kill(process.ppid, "SIGINT");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10_000);
    }
    return;
  }

  throw new Error(`Unhandled fake AWS call: ${args.join(" ")}`);
}

function fakeCurl(args) {
  const statePath = process.env.FAKE_AWS_STATE;
  if (!statePath) throw new Error("FAKE_AWS_STATE is required.");
  const state = readState(statePath);
  logCall(state, ["curl", ...args]);
  writeState(statePath, state);
  process.stdout.write(
    `HTTP/1.1 200 OK\r\nX-Ilo-Drain-Protocol: ${state.drainProtocol ?? "quiesce-v1"}\r\n\r\n`,
  );
}

if (process.argv[2] === "--fake-aws") {
  fakeAws(process.argv.slice(3));
} else if (process.argv[2] === "--fake-curl") {
  fakeCurl(process.argv.slice(3));
} else {
  const allSuspended = {
    DynamicScalingInSuspended: true,
    DynamicScalingOutSuspended: true,
    ScheduledScalingSuspended: true,
  };
  const originalSuspension = {
    DynamicScalingInSuspended: true,
    DynamicScalingOutSuspended: false,
    ScheduledScalingSuspended: true,
  };

  function baseState(overrides = {}) {
    const historical = {
      exitCode: 0,
      lastStatus: "STOPPED",
      stoppedAt: "2026-07-28T12:00:00+00:00",
    };
    const oldTask = {
      exitCode: 0,
      lastStatus: "STOPPED",
      stoppedAt: "2026-07-29T12:00:01+00:00",
      taskDefinitionArn: "old-task-definition",
    };
    const restoreState = JSON.stringify({
      desiredCount: 1,
      postDrainTaskDefinitionArns: [],
      recoveryAuthorized: false,
      suspendedState: originalSuspension,
    });
    const readyDefinition = (image, restore = restoreState) => ({
      containerDefinitions: [
        {
          environment: [
            { name: "API_SHUTDOWN_TIMEOUT_MS", value: "105000" },
            { name: "ILO_DEPLOYMENT_RESTORE_STATE", value: restore },
          ],
          image,
          name: "api",
          stopTimeout: 120,
        },
      ],
    });
    return {
      breaker: { enable: true, rollback: true },
      calls: [],
      cancelDuringRecoveryRegister: false,
      cancelDuringPostLaunchRead: false,
      cancelDuringPostZeroWait: false,
      denyRegister: false,
      deploymentAlarmState: "OK",
      deploymentMetricAttempts: 0,
      deploymentMetricValues: [],
      deploymentZeroPublishes: 0,
      describeScalingCalls: 0,
      desiredCount: 1,
      drainProtocol: "quiesce-v1",
      failDescribeScalingAt: undefined,
      failFirstServiceWait: false,
      failPostLaunchRead: false,
      pendingCount: 0,
      primaryTaskDefinition: "old-task-definition",
      registerTaskDefinitionCalls: 0,
      runningCount: 1,
      runningInventory: ["task-old"],
      serviceWaitCalls: 0,
      stoppedInventories: [
        ["task-historical"],
        ["task-historical"],
        ...Array.from({ length: 8 }, () => ["task-historical", "task-old"]),
      ],
      stoppedListCalls: 0,
      stoppedTaskUpdates: {},
      suspension: originalSuspension,
      taskDefinitions: {
        "new-task-definition": readyDefinition("api:new"),
        "old-task-definition": readyDefinition("api:old"),
      },
      tasks: {
        "task-historical": { ...historical, taskDefinitionArn: "old-task-definition" },
        "task-old": oldTask,
      },
      zeroCalls: 0,
      ...overrides,
    };
  }

  function runScenarioInDirectory(directory, state, initialize = true) {
    const statePath = resolve(directory, "state.json");
    const heartbeatLogPath = resolve(directory, "heartbeat.log");
    const bin = resolve(directory, "bin");
    if (initialize) {
      mkdirSync(bin);
      writeState(statePath, state);
      writeFileSync(heartbeatLogPath, "");
      writeFileSync(
        resolve(bin, "aws"),
        `#!/bin/sh\nexec "${process.execPath}" "${import.meta.filename}" --fake-aws "$@"\n`,
        { mode: 0o755 },
      );
      writeFileSync(
        resolve(bin, "curl"),
        `#!/bin/sh\nexec "${process.execPath}" "${import.meta.filename}" --fake-curl "$@"\n`,
        { mode: 0o755 },
      );
      writeFileSync(
        resolve(bin, "sleep"),
        '#!/bin/sh\nif test -n "$FAKE_MAIN_SLEEP_SECONDS"; then /bin/sleep "$FAKE_MAIN_SLEEP_SECONDS"; fi\n',
        { mode: 0o755 },
      );
    }
    const result = spawnSync("bash", [deployScript], {
      encoding: "utf8",
      env: {
        ...process.env,
        API_SERVICE: "ilo-api",
        API_TASK_DEFINITION: state.apiTaskDefinition ?? "new-task-definition",
        API_URL: "https://api.example.com",
        API_DEPLOYMENT_HEARTBEAT_BACKGROUND_ENABLED:
          state.heartbeatBackgroundEnabled === true ? "true" : "false",
        API_DEPLOYMENT_HEARTBEAT_INTERVAL_SECONDS: "0.01",
        API_DEPLOYMENT_HEARTBEAT_RETRY_SECONDS: "0.01",
        AWS_REGION: "us-east-1",
        ECS_CLUSTER: "ilo-production",
        FAKE_AWS_STATE: statePath,
        FAKE_HEARTBEAT_LOG: heartbeatLogPath,
        FAKE_MAIN_SLEEP_SECONDS: state.heartbeatBackgroundEnabled === true ? "0.05" : "",
        PATH: `${bin}${delimiter}${process.env.PATH}`,
      },
    });
    const heartbeatValues = readFileSync(heartbeatLogPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(Number);
    return { completedAt: Date.now(), heartbeatValues, result, state: readState(statePath) };
  }

  function runScenario(name, state) {
    const directory = mkdtempSync(resolve(tmpdir(), `ilo-drain-${name}-`));
    try {
      return runScenarioInDirectory(directory, state);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  }

  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  function setRestoreState(state, taskDefinition, restoreState) {
    const environment = state.taskDefinitions[taskDefinition].containerDefinitions[0].environment;
    const restoreEntry = environment.find((entry) => entry.name === "ILO_DEPLOYMENT_RESTORE_STATE");
    if (!restoreEntry) throw new Error(`Missing restore entry for ${taskDefinition}.`);
    restoreEntry.value = JSON.stringify(restoreState);
  }

  function setRecoveryMarker(state, taskDefinition, failedTaskDefinitionArn) {
    const environment = state.taskDefinitions[taskDefinition].containerDefinitions[0].environment;
    state.taskDefinitions[taskDefinition].containerDefinitions[0].environment = [
      ...environment.filter((entry) => entry.name !== "ILO_DEPLOYMENT_RECOVERY_MARKER"),
      {
        name: "ILO_DEPLOYMENT_RECOVERY_MARKER",
        value: JSON.stringify({ version: 1, failedTaskDefinitionArn }),
      },
    ];
  }

  const denied = runScenario("register-denied", baseState({ denyRegister: true }));
  assert(denied.result.status !== 0, "Missing Register permission must fail.");
  assert(
    denied.state.desiredCount === 1,
    "Missing Register permission must preserve desired count.",
  );
  assert(denied.state.zeroCalls === 0, "Missing Register permission must not begin service drain.");
  assert(
    denied.result.stdout.includes("could not prove exact scaling-state restoration"),
    "Failed pre-drain restoration must emit an operator-visible error.",
  );

  const unverifiedRestoration = runScenario(
    "restoration-read-failed",
    baseState({ failDescribeScalingAt: 4, failFirstServiceWait: true }),
  );
  assert(unverifiedRestoration.result.status !== 0, "A pre-drain wait failure must fail.");
  assert(
    unverifiedRestoration.state.desiredCount === 1,
    "A pre-drain failure must preserve the healthy service.",
  );
  assert(
    unverifiedRestoration.result.stdout.includes("could not prove exact scaling-state restoration"),
    "A failed restoration readback must emit an operator-visible unverified-state error.",
  );

  const cancelled = runScenario("cancel-after-zero", baseState({ cancelDuringPostZeroWait: true }));
  assert(
    cancelled.result.status === 130,
    `Cancellation after zero must exit with signal status (status=${cancelled.result.status}, signal=${cancelled.result.signal}, stderr=${cancelled.result.stderr}).`,
  );
  assert(
    cancelled.state.desiredCount === 0,
    "Cancellation recovery must leave desired count zero.",
  );
  assert(
    JSON.stringify(cancelled.state.suspension) === JSON.stringify(allSuspended),
    "Cancellation recovery must re-suspend all scaling modes.",
  );
  assert(
    cancelled.completedAt - cancelled.state.cancellationSignalAt < 20_000,
    `Cancellation must interrupt a blocked AWS waiter before runner escalation (elapsed=${cancelled.completedAt - cancelled.state.cancellationSignalAt}ms).`,
  );
  assert(cancelled.state.zeroCalls >= 2, "Cancellation recovery must issue a second zero.");
  assert(
    cancelled.state.calls.some(
      (call) =>
        call.startsWith("application-autoscaling register-scalable-target") &&
        call.includes("--cli-read-timeout 2"),
    ),
    "Cancellation recovery must issue the bounded scaling re-suspension.",
  );

  const postLaunchCancelled = runScenario(
    "cancel-post-launch-read",
    baseState({ cancelDuringPostLaunchRead: true }),
  );
  assert(
    postLaunchCancelled.result.status === 130,
    "Cancellation during a post-launch read must exit with signal status.",
  );
  assert(
    postLaunchCancelled.completedAt - postLaunchCancelled.state.cancellationSignalAt < 20_000,
    "Cancellation must interrupt a blocked post-launch AWS read.",
  );
  assert(
    postLaunchCancelled.state.desiredCount === 0 &&
      JSON.stringify(postLaunchCancelled.state.suspension) === JSON.stringify(allSuspended),
    "Post-launch cancellation must re-suspend scaling and return the service to zero.",
  );
  assert(
    postLaunchCancelled.state.zeroCalls >= 2,
    "Post-launch cancellation recovery must issue a second zero mutation.",
  );

  const recoveryCancelled = runScenario(
    "cancel-fail-closed-recovery",
    baseState({ cancelDuringRecoveryRegister: true, failPostLaunchRead: true }),
  );
  assert(
    recoveryCancelled.result.status === 143,
    "Cancellation during fail-closed recovery must exit through the TERM handler.",
  );
  assert(
    recoveryCancelled.completedAt - recoveryCancelled.state.cancellationSignalAt < 20_000,
    "Cancellation must interrupt a stalled fail-closed recovery request.",
  );
  assert(
    recoveryCancelled.state.desiredCount === 0 &&
      JSON.stringify(recoveryCancelled.state.suspension) === JSON.stringify(allSuspended),
    "Cancelled fail-closed recovery must still re-suspend scaling and stop at zero.",
  );
  assert(
    recoveryCancelled.state.zeroCalls >= 2,
    "Cancelled fail-closed recovery must issue the bounded cancellation zero.",
  );

  const replacement = {
    exitCode: 0,
    lastStatus: "STOPPED",
    stoppedAt: "2026-07-29T12:00:01+00:00",
  };
  const replacementState = baseState();
  replacementState.tasks["task-replacement"] = replacement;
  replacementState.stoppedInventories = [
    ["task-historical"],
    ["task-historical", "task-replacement"],
    ...Array.from({ length: 8 }, () => ["task-historical", "task-old", "task-replacement"]),
  ];
  const replacementResult = runScenario("replacement", replacementState);
  assert(replacementResult.result.status === 0, "Graceful replacement scenario must succeed.");
  assert(
    replacementResult.state.calls.some(
      (call) => call.startsWith("ecs describe-tasks") && call.includes("task-replacement"),
    ),
    "A task stopped during suspension must enter exact exit proof.",
  );

  const delayedReplacementState = baseState();
  delayedReplacementState.tasks["task-delayed-replacement"] = replacement;
  delayedReplacementState.stoppedInventories = [
    ["task-historical"],
    ["task-historical"],
    ...Array.from({ length: 7 }, () => ["task-historical", "task-old"]),
    ...Array.from({ length: 7 }, () => ["task-delayed-replacement", "task-historical", "task-old"]),
  ];
  const delayedReplacement = runScenario("delayed-replacement", delayedReplacementState);
  assert(
    delayedReplacement.result.status === 0,
    "A replacement exposed after the earlier short convergence window must still succeed.",
  );
  assert(
    delayedReplacement.state.calls.some(
      (call) => call.startsWith("ecs describe-tasks") && call.includes("task-delayed-replacement"),
    ),
    "Five-minute reconciliation must include a late-visible replacement in exit proof.",
  );

  const initiallyStoppingState = baseState();
  initiallyStoppingState.tasks["task-initially-stopping"] = {
    exitCode: undefined,
    lastStatus: "RUNNING",
  };
  initiallyStoppingState.stoppedInventories = [
    ["task-historical", "task-initially-stopping"],
    ...Array.from({ length: 15 }, () => ["task-historical", "task-initially-stopping", "task-old"]),
  ];
  initiallyStoppingState.stoppedTaskUpdates = {
    1: {
      "task-initially-stopping": {
        exitCode: 137,
        lastStatus: "STOPPED",
        reason: "SIGKILL",
        stoppedAt: "2026-07-29T11:59:59+00:00",
      },
    },
  };
  const initiallyStopping = runScenario("initially-stopping", initiallyStoppingState);
  assert(
    initiallyStopping.result.status !== 0,
    "A task still stopping in the initial baseline must remain in exact exit proof.",
  );
  assert(
    !initiallyStopping.state.calls.some(
      (call) => call.startsWith("ecs update-service") && call.includes("--task-definition"),
    ),
    "An initially stopping task with a failed exit must block migration startup.",
  );

  const killedState = baseState();
  killedState.tasks["task-old"] = {
    exitCode: 137,
    lastStatus: "STOPPED",
    reason: "SIGKILL",
    stoppedAt: "2026-07-29T12:00:01+00:00",
    stoppedReason: "Timeout waiting for container",
  };
  const killed = runScenario("killed", killedState);
  assert(killed.result.status !== 0, "SIGKILL task evidence must fail the deployment.");
  assert(
    !killed.state.calls.some(
      (call) => call.startsWith("ecs update-service") && call.includes("--task-definition"),
    ),
    "Migration-capable task must not start after nonzero/SIGKILL evidence.",
  );
  assert(killed.state.desiredCount === 0, "Post-zero failure must remain at desired count zero.");
  assert(
    JSON.stringify(killed.state.suspension) === JSON.stringify(allSuspended),
    "Post-zero failure must leave every scaling mode suspended.",
  );

  const missingTimestampState = baseState();
  missingTimestampState.tasks["task-unknown-time"] = {
    exitCode: 137,
    lastStatus: "STOPPED",
    reason: "SIGKILL",
    stoppedReason: "Timestamp not projected yet",
  };
  missingTimestampState.stoppedInventories = [
    ["task-historical"],
    ["task-historical", "task-unknown-time"],
    ...Array.from({ length: 8 }, () => ["task-historical", "task-old", "task-unknown-time"]),
  ];
  const missingTimestamp = runScenario("missing-timestamp", missingTimestampState);
  assert(
    missingTimestamp.result.status !== 0,
    "Missing stoppedAt evidence must not classify a task as historical.",
  );
  assert(
    !missingTimestamp.state.calls.some(
      (call) => call.startsWith("ecs update-service") && call.includes("--task-definition"),
    ),
    "Missing stoppedAt plus failed exit evidence must block migration startup.",
  );

  const success = runScenario("success", baseState());
  assert(success.result.status === 0, "Healthy exact drain scenario must succeed.");
  assert(
    JSON.stringify(success.state.suspension) === JSON.stringify(originalSuspension),
    "Success must restore the exact prior suspension state.",
  );
  assert(
    success.state.primaryTaskDefinition === "new-task-definition",
    "Success must launch the exact new task definition.",
  );
  assert(
    success.state.deploymentMetricValues[0] === 1 &&
      success.state.deploymentMetricValues.at(-1) === 0 &&
      success.state.deploymentAlarmState === "OK",
    "Success must activate deployment suppression before drain and restore paging afterward.",
  );
  const backgroundHeartbeat = runScenario(
    "background-heartbeat",
    baseState({
      heartbeatBackgroundEnabled: true,
      primaryRolloutStates: ["IN_PROGRESS", "COMPLETED"],
    }),
  );
  assert(
    backgroundHeartbeat.result.status === 0 &&
      backgroundHeartbeat.heartbeatValues.filter((value) => value === 1).length >= 2 &&
      backgroundHeartbeat.heartbeatValues.includes(0),
    `An enabled heartbeat must refresh during rollout and publish zero during cleanup (${JSON.stringify(backgroundHeartbeat.heartbeatValues)}; status=${backgroundHeartbeat.result.status}; stdout=${backgroundHeartbeat.result.stdout}; stderr=${backgroundHeartbeat.result.stderr}).`,
  );
  const failedBackgroundHeartbeat = runScenario(
    "failed-background-heartbeat",
    baseState({ failDeploymentMetricAfter: 1, heartbeatBackgroundEnabled: true }),
  );
  assert(
    failedBackgroundHeartbeat.result.status !== 0 &&
      failedBackgroundHeartbeat.result.stdout.includes(
        "API deployment heartbeat could not be refreshed",
      ),
    "Persistent heartbeat refresh failure must become parent-visible and fail the rollout.",
  );
  const unclearedDeploymentAlarm = runScenario(
    "uncleared-deployment-alarm",
    baseState({ stickyDeploymentAlarm: true }),
  );
  assert(
    unclearedDeploymentAlarm.result.status !== 0 &&
      unclearedDeploymentAlarm.result.stdout.includes(
        "API deployment heartbeat alarm did not clear",
      ),
    "A deployment must fail when CloudWatch cannot prove that suppression cleared.",
  );
  const delayedDeploymentAlarmClear = runScenario(
    "delayed-deployment-alarm-clear",
    baseState({ requiredDeploymentZeroPublishes: 3 }),
  );
  assert(
    delayedDeploymentAlarmClear.result.status === 0 &&
      delayedDeploymentAlarmClear.state.deploymentAlarmState === "OK" &&
      delayedDeploymentAlarmClear.heartbeatValues.filter((value) => value === 0).length >= 3,
    "Cleanup must keep publishing zero while waiting for CloudWatch to clear suppression.",
  );
  const delayedPrimary = runScenario(
    "delayed-primary-completion",
    baseState({ primaryRolloutStates: ["IN_PROGRESS", "COMPLETED"] }),
  );
  assert(
    delayedPrimary.result.status === 0,
    "A stable service whose primary completion is briefly delayed must succeed.",
  );
  assert(
    delayedPrimary.state.primaryRolloutStates.length === 0 &&
      delayedPrimary.state.desiredCount === 1,
    "Deployment must wait for exact primary completion without stopping the healthy task.",
  );
  const stalledPrimary = runScenario(
    "stalled-primary-completion",
    baseState({ primaryRolloutStates: Array.from({ length: 10 }, () => "IN_PROGRESS") }),
  );
  assert(
    stalledPrimary.result.status !== 0,
    "A primary that never completes inside the bounded poll must fail.",
  );
  assert(
    stalledPrimary.state.primaryRolloutStates.length === 0 &&
      stalledPrimary.state.desiredCount === 0 &&
      JSON.stringify(stalledPrimary.state.suspension) === JSON.stringify(allSuspended),
    `A stalled primary must exhaust the bounded poll and return to fail-closed zero (${JSON.stringify({ desiredCount: stalledPrimary.state.desiredCount, primaryRolloutStates: stalledPrimary.state.primaryRolloutStates, suspension: stalledPrimary.state.suspension, status: stalledPrimary.result.status })}).`,
  );
  const successfulReadiness = success.state.calls.findIndex((call) => call.startsWith("curl "));
  const successfulSuspension = success.state.calls.findIndex((call) =>
    call.startsWith("application-autoscaling register-scalable-target"),
  );
  const successfulDrain = success.state.calls.findIndex(
    (call) => call.startsWith("ecs update-service") && call.includes("--desired-count 0"),
  );
  const successfulHeartbeat = success.state.calls.findIndex(
    (call) =>
      call.startsWith("cloudwatch put-metric-data") &&
      call.includes("ApiDeploymentInProgress,Value=1"),
  );
  const successfulMigrationLaunch = success.state.calls.findIndex(
    (call) =>
      call.startsWith("ecs update-service") &&
      call.includes("--task-definition new-task-definition"),
  );
  assert(
    successfulReadiness >= 0 &&
      successfulReadiness < successfulSuspension &&
      successfulHeartbeat >= 0 &&
      successfulHeartbeat < successfulDrain &&
      successfulSuspension < successfulDrain &&
      successfulDrain < successfulMigrationLaunch,
    "The proven live quiesce prerequisite must precede suspension, exact drain, and migration startup.",
  );

  const retryDirectory = mkdtempSync(resolve(tmpdir(), "ilo-drain-retry-"));
  try {
    const firstAttempt = runScenarioInDirectory(
      retryDirectory,
      baseState({ failPostLaunchRead: true }),
    );
    assert(firstAttempt.result.status !== 0, "The first retry scenario run must fail post-drain.");
    assert(
      firstAttempt.state.desiredCount === 0 &&
        JSON.stringify(firstAttempt.state.suspension) === JSON.stringify(allSuspended) &&
        firstAttempt.state.breaker.rollback === false,
      "A post-launch failure must persist the recognizable fail-closed emergency posture.",
    );
    const persistedMarkerDefinition =
      firstAttempt.state.taskDefinitions[firstAttempt.state.latestTaskDefinition];
    const persistedMarker = persistedMarkerDefinition.containerDefinitions[0].environment.find(
      (entry) => entry.name === "ILO_DEPLOYMENT_RECOVERY_MARKER",
    );
    assert(
      JSON.parse(persistedMarker?.value ?? "{}").failedTaskDefinitionArn === "new-task-definition",
      "Handled post-drain failure must persist a marker tied to the failed release.",
    );
    const retryState = {
      ...firstAttempt.state,
      apiTaskDefinition: "retry-task-definition",
      calls: [],
      failPostLaunchRead: false,
      runningInventory: [],
      stoppedInventories: Array.from({ length: 20 }, () => ["task-historical", "task-old"]),
      stoppedListCalls: 0,
    };
    retryState.taskDefinitions["abandoned-retry-definition"] =
      structuredClone(persistedMarkerDefinition);
    setRestoreState(retryState, "abandoned-retry-definition", {
      desiredCount: 1,
      postDrainTaskDefinitionArns: ["new-task-definition"],
      recoveryAuthorized: true,
      suspendedState: originalSuspension,
    });
    retryState.latestTaskDefinition = "abandoned-retry-definition";
    assert(
      retryState.taskDefinitions[
        "abandoned-retry-definition"
      ].containerDefinitions[0].environment.some(
        (entry) => entry.name === "ILO_DEPLOYMENT_RECOVERY_MARKER",
      ),
      "A recovery candidate registered before a pre-script failure must retain its marker.",
    );
    retryState.taskDefinitions["retry-task-definition"] = structuredClone(
      retryState.taskDefinitions["abandoned-retry-definition"],
    );
    setRestoreState(retryState, "retry-task-definition", {
      desiredCount: 1,
      postDrainTaskDefinitionArns: ["new-task-definition"],
      recoveryAuthorized: true,
      suspendedState: originalSuspension,
    });
    writeState(resolve(retryDirectory, "state.json"), retryState);
    const secondAttempt = runScenarioInDirectory(retryDirectory, retryState, false);
    assert(
      secondAttempt.result.status === 0,
      `A second run must recover from fail-closed state (status ${
        secondAttempt.result.status
      }; stdout: ${secondAttempt.result.stdout}; stderr: ${secondAttempt.result.stderr}).`,
    );
    assert(
      secondAttempt.state.desiredCount === 1 &&
        JSON.stringify(secondAttempt.state.suspension) === JSON.stringify(originalSuspension) &&
        secondAttempt.state.breaker.rollback === true &&
        secondAttempt.state.primaryTaskDefinition === "retry-task-definition",
      "Successful retry must restore the persisted desired count, exact suspension intent, and rollback configuration.",
    );
    const clearedLatest =
      secondAttempt.state.taskDefinitions[secondAttempt.state.latestTaskDefinition];
    assert(
      !clearedLatest.containerDefinitions[0].environment.some(
        (entry) => entry.name === "ILO_DEPLOYMENT_RECOVERY_MARKER",
      ),
      "Successful retry must publish a marker-cleared latest task-definition revision.",
    );
  } finally {
    rmSync(retryDirectory, { force: true, recursive: true });
  }

  const intentionalStop = runScenario(
    "intentional-zero-suspended",
    baseState({
      desiredCount: 0,
      runningCount: 0,
      runningInventory: [],
      suspension: allSuspended,
    }),
  );
  assert(
    intentionalStop.result.status !== 0 &&
      intentionalStop.state.desiredCount === 0 &&
      intentionalStop.state.registerTaskDefinitionCalls === 0 &&
      !intentionalStop.state.calls.some(
        (call) =>
          call.startsWith("ecs update-service") &&
          call.includes("--task-definition new-task-definition"),
      ),
    "Intentional zero/all-suspended posture with stale normal metadata must not restart.",
  );

  const scaleRecoveryState = baseState({
    breaker: { enable: true, rollback: false },
    desiredCount: 0,
    runningCount: 0,
    runningInventory: [],
    suspension: allSuspended,
  });
  setRestoreState(scaleRecoveryState, "new-task-definition", {
    desiredCount: 2,
    postDrainTaskDefinitionArns: ["failed-migration-definition"],
    recoveryAuthorized: true,
    suspendedState: originalSuspension,
  });
  setRecoveryMarker(scaleRecoveryState, "new-task-definition", "failed-migration-definition");
  const scaleRecovery = runScenario("recover-scale-two", scaleRecoveryState);
  assert(scaleRecovery.result.status === 0, "A desired-count-two recovery must succeed.");
  const migrationLaunchCalls = scaleRecovery.state.calls.filter(
    (call) =>
      call.startsWith("ecs update-service") &&
      call.includes("--task-definition new-task-definition"),
  );
  assert(
    migrationLaunchCalls.length === 1 && migrationLaunchCalls[0].includes("--desired-count 1"),
    "Recovery must launch exactly one migration-capable API task.",
  );
  const recoveryMigrationLaunch = scaleRecovery.state.calls.findIndex(
    (call) =>
      call.startsWith("ecs update-service") &&
      call.includes("--task-definition new-task-definition"),
  );
  const firstRecoveryScalingRegistration = scaleRecovery.state.calls.findIndex((call) =>
    call.startsWith("application-autoscaling register-scalable-target"),
  );
  const firstRecoveryServiceWait = scaleRecovery.state.calls.findIndex((call) =>
    call.startsWith("ecs wait services-stable"),
  );
  assert(
    recoveryMigrationLaunch >= 0 &&
      firstRecoveryScalingRegistration > recoveryMigrationLaunch &&
      firstRecoveryServiceWait > recoveryMigrationLaunch,
    `A zero/all-suspended recovery must not mutate scaling or await generic service stability before the corrected API launches; scaling can enforce min capacity, while ECS retains the failed deployment and never satisfies the waiter at zero (launch ${recoveryMigrationLaunch}, scaling ${firstRecoveryScalingRegistration}, wait ${firstRecoveryServiceWait}; nearby calls: ${scaleRecovery.state.calls.slice(Math.max(0, firstRecoveryServiceWait - 2), firstRecoveryServiceWait + 2).join(" | ")}).`,
  );
  const restoreScaleCall = scaleRecovery.state.calls.findIndex(
    (call) =>
      call.startsWith("ecs update-service") &&
      call.includes("--desired-count 2") &&
      !call.includes("--task-definition"),
  );
  const rollbackRestoreCall = scaleRecovery.state.calls.findIndex(
    (call) =>
      call.startsWith("ecs update-service") &&
      call.includes("deploymentCircuitBreaker") &&
      call.includes('"rollback":true'),
  );
  assert(
    rollbackRestoreCall >= 0 &&
      restoreScaleCall > rollbackRestoreCall &&
      scaleRecovery.state.desiredCount === 2,
    "Persisted capacity must be restored only after serial migration health and rollback restoration.",
  );

  const failedMigrationRecovery = baseState({
    apiTaskDefinition: "retry-task-definition",
    breaker: { enable: true, rollback: false },
    desiredCount: 0,
    primaryTaskDefinition: "failed-migration-definition",
    runningCount: 0,
    runningInventory: [],
    suspension: allSuspended,
  });
  failedMigrationRecovery.taskDefinitions["failed-migration-definition"] = structuredClone(
    failedMigrationRecovery.taskDefinitions["old-task-definition"],
  );
  failedMigrationRecovery.taskDefinitions["retry-task-definition"] = structuredClone(
    failedMigrationRecovery.taskDefinitions["new-task-definition"],
  );
  setRestoreState(failedMigrationRecovery, "retry-task-definition", {
    desiredCount: 1,
    postDrainTaskDefinitionArns: ["failed-migration-definition"],
    recoveryAuthorized: true,
    suspendedState: originalSuspension,
  });
  setRecoveryMarker(
    failedMigrationRecovery,
    "retry-task-definition",
    "failed-migration-definition",
  );
  failedMigrationRecovery.tasks["task-failed-migration"] = {
    exitCode: 137,
    lastStatus: "STOPPED",
    reason: "SIGKILL",
    stoppedAt: "2026-07-29T12:02:00+00:00",
    stoppedReason: "Timeout waiting for container",
    taskDefinitionArn: "failed-migration-definition",
  };
  failedMigrationRecovery.stoppedInventories = Array.from({ length: 20 }, () => [
    "task-historical",
    "task-old",
    "task-failed-migration",
  ]);
  const failedMigrationRetry = runScenario("failed-migration-retry", failedMigrationRecovery);
  assert(
    failedMigrationRetry.result.status === 0,
    "A recorded failed migration task must not poison old-binary exit proof on retry.",
  );
  assert(
    failedMigrationRetry.state.primaryTaskDefinition === "retry-task-definition",
    "Recovery must launch the exact retry task definition after excluding recorded failed rollout evidence.",
  );
  const unlistedFailedMigration = structuredClone(failedMigrationRecovery);
  setRestoreState(unlistedFailedMigration, "retry-task-definition", {
    desiredCount: 1,
    postDrainTaskDefinitionArns: ["different-failed-definition"],
    recoveryAuthorized: true,
    suspendedState: originalSuspension,
  });
  setRecoveryMarker(
    unlistedFailedMigration,
    "retry-task-definition",
    "different-failed-definition",
  );
  const unlistedFailedRetry = runScenario("unlisted-failed-migration", unlistedFailedMigration);
  assert(
    unlistedFailedRetry.result.status !== 0 &&
      !unlistedFailedRetry.state.calls.some(
        (call) =>
          call.startsWith("ecs update-service") &&
          call.includes("--task-definition retry-task-definition"),
      ),
    "An unlisted nonzero task must remain in old-task exit proof and block retry startup.",
  );

  const repeatedRecovery = baseState({
    apiTaskDefinition: "retry-v3",
    breaker: { enable: true, rollback: false },
    desiredCount: 0,
    primaryTaskDefinition: "failed-v2",
    runningCount: 0,
    runningInventory: [],
    suspension: allSuspended,
  });
  for (const definition of ["failed-v1", "failed-v2", "retry-v3"]) {
    repeatedRecovery.taskDefinitions[definition] = structuredClone(
      repeatedRecovery.taskDefinitions["new-task-definition"],
    );
  }
  setRestoreState(repeatedRecovery, "retry-v3", {
    desiredCount: 1,
    postDrainTaskDefinitionArns: ["failed-v1", "failed-v2"],
    recoveryAuthorized: true,
    suspendedState: originalSuspension,
  });
  setRecoveryMarker(repeatedRecovery, "retry-v3", "failed-v2");
  for (const [index, definition] of ["failed-v1", "failed-v2"].entries()) {
    repeatedRecovery.tasks[`task-${definition}`] = {
      exitCode: 137,
      lastStatus: "STOPPED",
      reason: "SIGKILL",
      stoppedAt: `2026-07-29T12:0${index + 2}:00+00:00`,
      stoppedReason: "Timeout waiting for container",
      taskDefinitionArn: definition,
    };
  }
  repeatedRecovery.stoppedInventories = Array.from({ length: 20 }, () => [
    "task-historical",
    "task-old",
    "task-failed-v1",
    "task-failed-v2",
  ]);
  const repeatedRetry = runScenario("repeated-failed-migration-retry", repeatedRecovery);
  assert(
    repeatedRetry.result.status === 0 && repeatedRetry.state.primaryTaskDefinition === "retry-v3",
    "Repeated recovery must honor the bounded accumulated failed-task-definition set.",
  );

  const legacyDefinition = {
    containerDefinitions: [
      {
        environment: [],
        image: "api:legacy",
        name: "api",
        stopTimeout: 30,
      },
    ],
  };
  const legacy = runScenario(
    "legacy-primary",
    baseState({
      taskDefinitions: {
        "new-task-definition": baseState().taskDefinitions["new-task-definition"],
        "old-task-definition": legacyDefinition,
      },
    }),
  );
  assert(legacy.result.status !== 0, "A legacy primary must fail the rollout readiness gate.");
  assert(
    legacy.state.zeroCalls === 0 &&
      !legacy.state.calls.some((call) =>
        call.startsWith("application-autoscaling register-scalable-target"),
      ),
    "The lifecycle bootstrap gate must fail before scaling suspension or service drain.",
  );
  assert(
    legacy.result.stdout.includes("prerequisite 120-second/105-second shutdown rollout"),
    "The lifecycle bootstrap failure must name the required shutdown prerequisite rollout.",
  );

  for (const [name, mutate] of [
    [
      "missing-shutdown-timeout",
      (environment) => environment.filter((entry) => entry.name !== "API_SHUTDOWN_TIMEOUT_MS"),
    ],
    [
      "wrong-shutdown-timeout",
      (environment) =>
        environment.map((entry) =>
          entry.name === "API_SHUTDOWN_TIMEOUT_MS" ? { ...entry, value: "104999" } : entry,
        ),
    ],
    [
      "duplicate-shutdown-timeout",
      (environment) => [...environment, { name: "API_SHUTDOWN_TIMEOUT_MS", value: "105000" }],
    ],
  ]) {
    const invalidShutdown = baseState();
    invalidShutdown.taskDefinitions["old-task-definition"].containerDefinitions[0].environment =
      mutate(
        invalidShutdown.taskDefinitions["old-task-definition"].containerDefinitions[0].environment,
      );
    const invalidShutdownResult = runScenario(name, invalidShutdown);
    assert(
      invalidShutdownResult.result.status !== 0 &&
        invalidShutdownResult.state.zeroCalls === 0 &&
        !invalidShutdownResult.state.calls.some((call) =>
          call.startsWith("application-autoscaling register-scalable-target"),
        ),
      `${name} must fail the exact shutdown contract before rollout mutation.`,
    );
  }

  const mixedDigestState = baseState({
    desiredCount: 2,
    runningCount: 2,
    runningInventory: ["task-old", "task-old-second"],
  });
  setRestoreState(mixedDigestState, "new-task-definition", {
    desiredCount: 2,
    postDrainTaskDefinitionArns: [],
    recoveryAuthorized: false,
    suspendedState: originalSuspension,
  });
  mixedDigestState.tasks["task-old"].imageDigest = "sha256:first";
  mixedDigestState.tasks["task-old-second"] = {
    imageDigest: "sha256:second",
    lastStatus: "STOPPED",
    taskDefinitionArn: "old-task-definition",
  };
  const mixedDigest = runScenario("mixed-image-digests", mixedDigestState);
  assert(mixedDigest.result.status !== 0, "Mixed live image digests must fail.");
  assert(
    mixedDigest.state.zeroCalls === 0 &&
      !mixedDigest.state.calls.some((call) =>
        call.startsWith("application-autoscaling register-scalable-target"),
      ),
    "Same-tag tasks with mixed image digests must fail before scaling mutation.",
  );
  const emptyDigestState = baseState();
  emptyDigestState.tasks["task-old"].imageDigest = "";
  const emptyDigest = runScenario("empty-image-digest", emptyDigestState);
  assert(
    emptyDigest.result.status !== 0 && emptyDigest.state.zeroCalls === 0,
    "An empty live API image digest must fail before service drain.",
  );

  const unready = runScenario("missing-quiesce-readiness", baseState({ drainProtocol: "legacy" }));
  assert(unready.result.status !== 0, "Missing quiesce-v1 readiness evidence must fail.");
  assert(
    unready.state.zeroCalls === 0 &&
      !unready.state.calls.some((call) =>
        call.startsWith("application-autoscaling register-scalable-target"),
      ),
    "Readiness protocol proof must complete before scaling suspension or service drain.",
  );
  const readinessCall = unready.state.calls.findIndex((call) => call.startsWith("curl "));
  const firstMutation = unready.state.calls.findIndex((call) =>
    call.startsWith("application-autoscaling register-scalable-target"),
  );
  assert(
    readinessCall >= 0 && firstMutation === -1,
    "The exact readiness endpoint must be observed before any rollout mutation.",
  );

  const overflowState = baseState({
    stoppedInventories: [
      Array.from({ length: 101 }, (_value, index) => `task-historical-${index}`),
    ],
  });
  const overflow = runScenario("overflow", overflowState);
  assert(overflow.result.status !== 0, "A >100 task baseline must fail.");
  assert(overflow.state.zeroCalls === 0, "A >100 task baseline must fail before service drain.");
  assert(
    !overflow.state.calls.some((call) =>
      call.startsWith("application-autoscaling register-scalable-target"),
    ),
    "A >100 task baseline must fail before scaling mutation.",
  );

  console.log("Deployment drain fake-AWS scenarios passed.");
}
