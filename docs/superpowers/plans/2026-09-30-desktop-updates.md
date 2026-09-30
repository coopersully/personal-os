# Desktop Downloads and Updates Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. User explicitly selected autonomous design and self-review in this session.

**Goal:** Deliver production-connected Mac installers with safe launch-time automatic updates and one release surface.
**Architecture:** Native Tauri updater owns the update lifecycle and signature verification. GitHub Releases supplies an atomic stable feed and signed artifacts; API/connector validates public release metadata; web composes Downloads and update settings.
**Tech Stack:** Tauri 2, Rust, React, shadcn, GitHub Actions, Node release scripts.
**Spec:** ../specs/2026-09-30-desktop-updates-design.md

## Global constraints

macOS 14+, Apple Silicon and Intel; preserve bundle/Keychain identities. Update checks 8 seconds, downloads 120 seconds, automatic throttle six hours. No interactive app during automatic install. Production releases require valid signing configuration. User-facing product spelling is nohmi.

## Review focus

1. Escape racing download completion must revoke automatic installation.
2. Missing/stale/invalid feed must not claim latest or block offline use.
3. Widget embedding must precede notarization and updater archive signing.
4. Reopen/manual/startup requests must share one operation lock.
5. Public download links must match the release version and architecture; self-hosting must not claim production compatibility.

## Task 1 — Release contract and publication

Files: apps/desktop/scripts/release-metadata.mjs and its node tests; apps/desktop/macos/scripts/release.sh; .github/workflows/release.yml; docs/releasing.md.
- [x] Test missing artifacts/signatures, mismatched versions, valid two-architecture manifest and stable asset names.
- [x] Generate latest.json from actual final release assets; validate tag/package/Cargo/Tauri versions.
- [x] Add post-notarization archives/signatures; split macOS publication from optional Windows installer workflow.
- [x] Verify with node --test and bash syntax checks.

## Task 2 — Native updater and startup gate

Files: apps/desktop/src-tauri/src/updates.rs, lib.rs, lifecycle.rs, build.rs, Cargo.toml; apps/web/src/features/desktop/updates.tsx and update-bridge.ts; main.tsx.
Interfaces: desktop_update_status, desktop_update_check, desktop_update_open, desktop_update_restart; status includes installedVersion, availableVersion, phase, downloadedBytes, totalBytes, checkedAt, error, startupBlocking.
- [x] Add state-policy tests for automatic throttle and install authority; review serialized operation and startup escape races.
- [x] Register updater with compile-time public key, fixed HTTPS endpoint, bounded check/download, staged verified bytes and sanitized errors.
- [x] Gate interactive app until startup check/install/escape settles; reopen triggers throttled background check.
- [x] Add accessible Settings status and confirmed manual restart; reject restart during active ritual.
- [x] Run Rust and focused React tests.

## Task 3 — Consolidated downloads

Files: packages/domain/src/desktop-release.ts; packages/connectors/src/desktop-release.ts; apps/api/src/desktop-release-service.ts; packages/api-client/src/features/desktop-release.ts; apps/web/src/features/desktop/downloads.tsx; minimal composition wiring.
- [x] Test trusted artifact parsing, empty/unavailable release, timeout and unsafe links.
- [x] Serve bounded cached public metadata through API and typed client.
- [x] Compose public /downloads and Settings entry with real version, Mac architecture links and notes; keep self-hosting honest.
- [x] Add focused UI/API tests.

## Task 4 — Convergence and handoff

- [x] Self-review against each spec requirement and boundary failure case; fix gaps.
- [x] Complete pnpm verify; focused native/release/web checks passed.
- [x] Reconcile final evidence in current docs and Linear for the existing draft PR.
- [x] Configure Apple signing/provisioning and updater keys; build and notarize both architectures.
- [x] Install the signed Apple Silicon candidate and confirm existing account access.
- [ ] Record installed old-to-new upgrade acceptance and enable stable automatic publication.

## Implementation evidence (2026-09-30)

Tasks 1–3 are implemented as one cohesive source change on the existing shared
branch. Self-review and a separate read-only whole-change review found no
remaining actionable source defects. Native tests passed (50), release metadata
tests passed (3), and focused UI/API/connector checks passed. Full `pnpm verify` passed: 2,836 tests across 279 files, production builds,
repository checks, lint/typechecks, and 32 desktop/mobile browser tests. Coverage
was 96.76% statements/lines, 95.67% functions and 94.02% branches. Native
`cargo test` passed all 50 tests. The draft PR records the published source head.

Apple signing/provisioning and updater credentials are configured. Candidate run
36738710224 successfully signed and notarized both architectures. The Apple Silicon
app passed Gatekeeper and staple verification and was installed with the prior bundle
backed up; existing account access was retained. Installed old-to-new upgrade acceptance
and first stable publication remain outstanding. Automatic publication is gated off
until that acceptance completes.


## Automatic release delivery extension

1. Add version reservation and release-scope reconciliation with real temporary Git integration tests.
2. Extend the existing signed pipeline to consume the reserved source and publish only after the live Mac API reports readiness and the same source revision.
3. Cover retries, immutable public assets, stale sources, partial artifacts, rollout switch and failures.
4. Update release documentation and Linear, run repository verification and independent PR review.
5. Merge, build the first complete draft, prove the installed upgrade, then enable automatic publication.
