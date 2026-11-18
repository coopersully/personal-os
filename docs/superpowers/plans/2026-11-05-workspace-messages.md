# Workspace Messages Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for the bounded tasks below.

**Goal:** Reliable fallback notices, tagged workspace conversation views and evidence-based unlock.
**Architecture:** Extend canonical Texting records and run protocol; reuse existing SMS transport.
**Tech Stack:** Drizzle/PostgreSQL, Zod, Hono, MCP, React/TanStack Query, Vitest, Playwright.
**Spec:** ../specs/2026-11-05-workspace-messages-design.md

## Global Constraints
- Full originals across related workspaces; no message copies or rewritten human text.
- No paid fallback, no production sends; preserve current owner/consent/grant boundaries.
- One notice/run, fifteen-minute owner cooldown, five-minute delayed-response threshold.
- Phone/routine/authorization-bound delivered agent reply is required for chat unlock.
- Preserve existing Finance chat; /messages and /{workspace}/messages share the SMS surface.

## Review Focus
- Cross-owner classification/reply references must be rejected.
- Filtering must precede pagination and must not yield misleading send receipts.
- Changed setup and system messages cannot inherit or manufacture reply proof.
- Concurrent notification ticks/replies cannot send duplicate notices.
- Account changes and locked states cannot expose cached conversation data.

## Task 1 — Protocol, persistence and queries
Files: domain texting contracts, database schema/new migration, API texting and agent services,
associated PostgreSQL tests, typed API client and MCP tools.
- [x] Add canonical message workspaces, sender kind, reply references and idempotent run reply keys.
- [x] Agent checkpoint annotates current batch; reply supports multiple bounded topic messages.
- [x] Query workspace filter before pagination; expose current chatReady and verifiedAt proof.
- [x] Test owner isolation, membership, reply replay, filtering and evidence invalidation.

## Task 2 — Durable failure notices
Files: new API texting-agent-notices.ts/test, API composition; run notice identity migration in Task 1.
- [x] Scan bounded failed/stale runs and prepare consent-fenced, rate-bounded system notice.
- [x] Reuse sendNotification commit-before-send boundary; no uncertain replay.
- [x] Test rejection, uncertainty, stale runs, deduplication, cooldown and consent revocation.

## Task 3 — Shared screens and browser preview
Files: Texting conversation/setup UI, workspace navigation/routes, browser fixtures and tests.
- [x] Gate all chat entry points on server chatReady; keep setup steps actionable.
- [x] Render canonical workspace-tagged exchanges, global navigation and workspace projections.
- [x] Test locked/verified/filter/recovery states on desktop/mobile.
- [x] Inspect app in in-app browser with clearly identified demo states.

## Task 4 — Acceptance
- [x] Update canonical product/boundary documentation and Linear scope/evidence.
- [x] Run focused checks during work, consolidated typecheck/lint/build/browser checks at end.
- [x] Independent review, repair material findings, commit and push branch. No merge/deployment.

## Acceptance evidence — November 5

Parallel backend and frontend implementation; independent correctness review identified and repaired
lost rate-limit reply linkage, ambiguous legacy sender identity, and no-op configuration invalidating
proof. Runs now snapshot exact inbound IDs and a canonical internal provider-binding fingerprint.
Credential rotation invalidates proof; saving the same configuration preserves it. Topic replies
require corresponding inbound workspace tags; annotations cannot orphan previously sent replies.
Direct sends support optional validated metadata; known Finance notifications/acknowledgements and
bounded Finance replies are classified explicitly. No retrospective inference or provider call occurs.

Focused consolidated checks covered 165 tests plus 103 Finance notification/completion tests.
Three five-second database tests timed out under concurrent host load; affected suites plus notice
migration tests were rerun with one worker: 101/101 passed. Remaining consolidated tests passed.
Four desktop/mobile browser cases passed; screenshots and live in-app browser were inspected,
including 108px final-message clearance above the mobile dock. Full repository typecheck, lint and
build passed, with targeted API typecheck after fixing a clock-reference error. Full release
coverage and `pnpm verify` are not claimed. No production SMS, deployment or merge performed.

The development runtime applied the initial host-binding migration before input-snapshot work was
added. Restored that migration's original single-column transition and placed the snapshot in
0135 so existing local databases upgrade safely; fresh migration integration and the live local
status endpoint both pass. No user data was reset. Local demo previews are fictional; the real
unconfigured account remains behind the gate. Actual routine and carrier round-trip remains rollout
acceptance evidence.
