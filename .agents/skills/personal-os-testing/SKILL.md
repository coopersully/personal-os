---
name: personal-os-testing
description: Verify Personal OS changes at the appropriate unit, API integration, UI, and end-to-end layers. Use when adding or reviewing tests, investigating test failures, choosing a test layer, or preparing a change for handoff.
---

# Personal OS testing

The repository requires `pnpm verify` before handoff. It runs environment
checks, linting, type checks, high-threshold coverage, production builds, and
desktop/mobile Playwright acceptance tests.

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

Run the nearest focused test while iterating, then run `pnpm verify` for the
complete change. Do not lower coverage thresholds or exclude product code to
make a change pass. Preserve deterministic fixtures and avoid real provider
credentials or network calls in tests.
