## Overview

<!-- What changed and why it matters, in one or two sentences. -->

### Work map

<!-- Use `Closes #N` only when this PR fully completes the issue; otherwise use `Refs #N`. -->

- **Issue:** No tracking issue needed — <!-- explain why, or replace with a linked issue -->
- **Reference:** <!-- link one to three current repository documents needed for review -->

## Why this change

- **Problem:**
- **Safety rules:**
- **Approach:**

## What changed

-

## Documentation

<!-- Link updated current docs, or explain why durable documentation did not change. -->

- Reviewed — no update required:

## Verification

| Check | What it proves |
| --- | --- |
| `pnpm verify` | Repository checks, lint, types, coverage, builds, and acceptance tests pass |

<!--
Include Boundary analysis when this PR adds or changes an external dependency, credential,
callback, webhook, scheduled handoff, network path, or production-only capability. Otherwise
delete the section.
-->

## Boundary analysis

- **Durable commit point:**
- **Production disconfirming case:**
- **Evidence:**
- **Remaining proof:**

### Manual checks

- Step:

### Not covered locally

-

<!-- Delete Scope and limitations when there is no material non-goal, risk, or follow-up. -->

## Scope and limitations

-

## Author checklist

- [ ] The diff contains no unrelated changes, secrets, personal information, or private payloads.
- [ ] New behavior has focused tests at the appropriate layer.
- [ ] Current documentation matches behavior, interfaces, operations, and rollout.
- [ ] External-boundary claims distinguish configuration from production-equivalent evidence.
- [ ] `pnpm verify` passes, or the exact authorized gap is documented above.
