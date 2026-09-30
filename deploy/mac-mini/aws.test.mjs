import assert from "node:assert/strict";
import test from "node:test";
import { projectEnvironment, serviceDefinition } from "./aws.mjs";

test("AWS inspection requires a stable single deployment", () => {
  const service = {
    taskDefinition: "task:42",
    deployments: [{ rolloutState: "COMPLETED" }],
    pendingCount: 0,
    runningCount: 1,
    desiredCount: 1,
  };
  assert.equal(serviceDefinition(service), "task:42");
  assert.equal(serviceDefinition({ ...service, runningCount: 0, desiredCount: 0 }), "task:42");
  for (const change of [
    { runningCount: 0 },
    { pendingCount: 1 },
    { deployments: [{}, {}] },
    { deployments: [{ rolloutState: "IN_PROGRESS" }] },
  ])
    assert.throws(() => serviceDefinition({ ...service, ...change }));
});

test("export resolves all deployed references and rejects duplicate environment names", () => {
  const arn = "arn:aws:ssm:us-east-1:686584420666:parameter/ilo/SECRET";
  const container = {
    environment: [{ name: "REGISTRATION_MODE", value: "invite" }],
    secrets: [{ name: "SECRET", valueFrom: arn }],
  };
  assert.deepEqual(projectEnvironment(container, { [arn]: "canary" }), {
    REGISTRATION_MODE: "invite",
    SECRET: "canary",
  });
  assert.throws(() => projectEnvironment(container, {}));
  assert.throws(() =>
    projectEnvironment(
      { ...container, environment: [{ name: "SECRET", value: "plain" }] },
      { [arn]: "canary" },
    ),
  );
});
