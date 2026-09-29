# Deployment Heartbeat Clear Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent healthy production releases from failing when CloudWatch clears the API deployment heartbeat alarm after the former 85-second polling deadline.

**Architecture:** Preserve the existing fail-closed alarm proof and zero-heartbeat refresh behavior. Increase the shared bounded alarm-state polling loop to 180 seconds and prove it with the existing fake-AWS deployment-drain harness.

**Tech Stack:** Bash, Node.js fake-AWS scenario runner, CloudWatch alarms, GitHub Actions

## Global Constraints

- Never infer alarm clearance from a successful metric publication.
- Keep the wait bounded at 180 seconds.
- Continue publishing zero during cleanup.
- Preserve paging restoration when heartbeat samples disappear.

---

### Task 1: Cover delayed CloudWatch evaluation and extend the bound

**Files:**
- Modify: `scripts/check-deployment-drain-scenarios.mjs`
- Modify: `.github/scripts/deploy-api.sh`
- Modify: `docs/deployment.md`

**Interfaces:**
- Consumes: `wait_for_api_deployment_alarm_state <expected-state> [refresh-value]`
- Produces: a maximum of 36 observations with five-second spacing after the initial observation, totaling a 180-second bounded window

- [ ] **Step 1: Write the failing regression scenario**

Change `delayed-deployment-alarm-clear` to require 20 zero publications and assert at least 20 were emitted before the alarm reached `OK`.

- [ ] **Step 2: Run the scenario to verify it fails**

Run: `node scripts/check-deployment-drain-scenarios.mjs`

Expected: FAIL because the old loop can publish only 18 zero samples.

- [ ] **Step 3: Implement the minimal bounded wait change**

Replace the fixed 18-delay list in `wait_for_api_deployment_alarm_state` with 36 observations: one immediate observation followed by 35 five-second delays.

- [ ] **Step 4: Update the deployment contract documentation**

State that activation and cleanup wait up to three minutes for the actual CloudWatch alarm transition and continue refreshing the intended heartbeat value while waiting.

- [ ] **Step 5: Verify focused behavior**

Run:

```bash
bash -n .github/scripts/deploy-api.sh
node scripts/check-deployment-drain-scenarios.mjs
node scripts/check-deployment-drain-contract.mjs
```

Expected: all commands exit successfully.

- [ ] **Step 6: Verify the repository and publish**

Run `pnpm verify`, commit the focused files, push the branch, open a pull request, and merge only after required checks succeed.

- [ ] **Step 7: Prove the release live**

Run the production workflow for current `main`, then correlate the `production/ilo` commit status, ECS API and MCP immutable image tags, S3 `index.html` publication time, and all three public health endpoints.
