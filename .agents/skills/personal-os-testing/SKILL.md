---
name: personal-os-testing
description: Verify personal-os changes at the appropriate unit, API integration, UI, and end-to-end layers. Use when adding or reviewing tests, investigating test failures, choosing a test layer, or preparing a change for handoff.
---

# personal-os testing

Final acceptance requires policy-complete local or hosted verification under
`docs/engineering/delivery-verification.md`, including its Git-verified prose-only exception;
iteration and early handoffs use focused evidence.
The local `pnpm verify` runs environment
checks, linting, type checks, high-threshold coverage, production builds, and
desktop/mobile Playwright acceptance tests.

Use `docs/engineering/development-handbook.md` and its offline planner to identify missing steps
and reusable receipts. This does not replace this skill's authority, role or acceptance gates.

## Choose the narrowest effective layer

- Use Vitest unit tests for pure domain logic, serialization, parsing, and
  feature helpers.
- Use API integration tests for persistence, authorization, migrations,
  service behavior, and HTTP contracts.
- Use Testing Library for React component and interaction behavior.
- Use Playwright for full user flows, routing, responsive behavior, or an
  interaction that crosses application boundaries. The suite runs desktop and
  mobile Chromium projects serially.

## Test the contract, not implementation detail

Exercise public behavior, authorization failures, validation errors, empty and
provider-failure states, and mutation audit/policy effects where applicable.
When a migration transforms existing data, add a targeted preservation test.
Avoid tests that only mirror component internals or generated UI primitives.

## Run proportionate verification

Follow `docs/engineering/verification-efficiency.md` for iteration. Use the shared verification
planner for package/consumer scope, then select behavior-specific tests. Share current-candidate
receipts with reviewers; only one execution owner runs checks. The planner never grants merge
readiness or replaces the final verification contract.


Run the nearest focused test while iterating, then obtain the final verification scope
required by the delivery contract. Do not run application suites for proven prose-only scope. Do not lower coverage thresholds or exclude product code to
make a change pass. Preserve deterministic fixtures and avoid real provider
credentials or network calls in tests.

## Shipping verification policy

For an authorized ship-it run, follow `docs/engineering/delivery-verification.md`: converge review
with focused checks, freeze/commit the candidate, then obtain complete local or equivalent hosted
verification. This replaces duplicate full-suite invocations in the steps above; it does not waive
any required check, unexplained failure, or issue-specific acceptance. Local `pnpm verify` uses the
shared host runner. Metadata-only changes refresh metadata gates, not unchanged source verification.
