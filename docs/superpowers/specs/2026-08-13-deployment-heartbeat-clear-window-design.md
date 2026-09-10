# Deployment Heartbeat Clear Window Design

## Problem

The production API rollout for commit `0926d4c` reached ECS steady state, published a zero deployment heartbeat, and left the API healthy. The deploy script stopped polling after 85 seconds, while CloudWatch changed `personal-os-prod-api-deployment-in-progress` to `OK` eight seconds later. The workflow therefore failed closed before deploying MCP or publishing web assets.

## Design

Keep the existing safety contract: deployment succeeds only after the real CloudWatch alarm reports `OK`, and cleanup continues publishing zero while it waits. Extend the bounded alarm-state polling window from 85 seconds to 180 seconds so it covers CloudWatch's one-minute metric period plus observed evaluation delay. Do not bypass, mutate, or infer the alarm state from metric publication alone.

Add a deterministic drain scenario that requires more zero publications than the old window allowed. The scenario must fail against the old polling bound and pass with the new bound. Update deployment documentation to state the three-minute proof window.

## Verification and Release

Run the focused drain scenarios and contract checks, then the repository verification action. Publish the focused branch and merge it through normal GitHub checks. Run the production deployment for current `main` and verify that the API and MCP ECS images, web asset publication time, GitHub production status, and public health endpoints all agree on the release.

## Boundary Record

- Capability and owner: the GitHub deploy workflow owns serial ECS deployment and CloudWatch deployment-suppression proof.
- Authority and transport: the existing production deploy role publishes and reads the namespace-scoped CloudWatch metric and alarm in `us-east-1`.
- Time: alarm activation and clearing are each bounded to 180 seconds, polling every five seconds after the initial observation.
- Recovery: a timeout still fails the workflow; missing heartbeat data remains non-breaching so paging is restored.
- Evidence: deterministic fake-AWS scenarios, static deployment-contract checks, GitHub workflow status, ECS immutable image tags, S3 publication time, and public health endpoints.
