import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const deployScript = resolve(root, ".github/scripts/deploy-api.sh");

function readState(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeState(path, state) {
  writeFileSync(path, `${JSON.stringify(state)}\n`);
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
      return {
        containers: [
          {
            exitCode: task.exitCode,
            lastStatus: task.lastStatus,
            name: "api",
            reason: task.reason ?? "",
          },
        ],
        lastStatus: task.lastStatus,
        stoppedAt: task.stoppedAt,
        stoppedReason: task.stoppedReason ?? "",
        taskArn,
      };
    });
    writeState(statePath, state);
    process.stdout.write(JSON.stringify({ failures: [], tasks }));
    return;
  }

  if (service === "ecs" && operation === "describe-services") {
    const query = argument(args, "--query") ?? "";
    writeState(statePath, state);
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
                rolloutState: "COMPLETED",
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
    if (taskDefinition) state.primaryTaskDefinition = taskDefinition;
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

if (process.argv[2] === "--fake-aws") {
  fakeAws(process.argv.slice(3));
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
    };
    return {
      breaker: { enable: true, rollback: true },
      calls: [],
      cancelDuringRecoveryRegister: false,
      cancelDuringPostLaunchRead: false,
      cancelDuringPostZeroWait: false,
      denyRegister: false,
      describeScalingCalls: 0,
      desiredCount: 1,
      failDescribeScalingAt: undefined,
      failFirstServiceWait: false,
      failPostLaunchRead: false,
      pendingCount: 0,
      primaryTaskDefinition: "old-task-definition",
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
      tasks: { "task-historical": historical, "task-old": oldTask },
      zeroCalls: 0,
      ...overrides,
    };
  }

  function runScenario(name, state) {
    const directory = mkdtempSync(resolve(tmpdir(), `ilo-drain-${name}-`));
    const statePath = resolve(directory, "state.json");
    const bin = resolve(directory, "bin");
    mkdirSync(bin);
    writeState(statePath, state);
    writeFileSync(
      resolve(bin, "aws"),
      `#!/bin/sh\nexec "${process.execPath}" "${import.meta.filename}" --fake-aws "$@"\n`,
      { mode: 0o755 },
    );
    writeFileSync(resolve(bin, "sleep"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    try {
      const result = spawnSync("bash", [deployScript], {
        encoding: "utf8",
        env: {
          ...process.env,
          API_SERVICE: "ilo-api",
          API_TASK_DEFINITION: "new-task-definition",
          ECS_CLUSTER: "ilo-production",
          FAKE_AWS_STATE: statePath,
          PATH: `${bin}${delimiter}${process.env.PATH}`,
        },
      });
      return { completedAt: Date.now(), result, state: readState(statePath) };
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  }

  function assert(condition, message) {
    if (!condition) throw new Error(message);
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
    baseState({ failDescribeScalingAt: 3, failFirstServiceWait: true }),
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
    cancelled.completedAt - cancelled.state.cancellationSignalAt < 5_000,
    "Cancellation must interrupt a blocked AWS waiter before runner escalation.",
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
    postLaunchCancelled.completedAt - postLaunchCancelled.state.cancellationSignalAt < 5_000,
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
    recoveryCancelled.completedAt - recoveryCancelled.state.cancellationSignalAt < 5_000,
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
