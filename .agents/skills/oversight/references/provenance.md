# Provenance and evaluation cases

This replacement models the personal `oversight` skill and its `references/lifecycle.md` and
`references/monitoring.md`, read October 23, 2026. Baseline mapping, bounded authority, one next-step
lifecycle, dispatch deduplication, incremental observation, evidence reuse and safe reset are adapted
here with nohmi role, tracking, review and reporting contracts. The personal installation is neither
modified nor required at execution time; the repository references contain the needed mechanics.

The other verified source is Occupi's
[Fast, trustworthy agent verification specification](https://github.com/Occupi-App/occupi/blob/development/docs/superpowers/specs/2026-10-16-fast-verification.md),
read October 23, 2026. It describes intended behavior, not proof of shipped capability. No separate
Occupi oversight skill was found in the source search; this is not a copy of one. Adopted principles
are single-owner heavy work, focused repair, complete readiness distinct from selected execution,
safe evidence identity, preparation distinct from result reuse, resource isolation and independent
measurement. Occupi commands, framework versions, merge rules and labels are not nohmi policy.

nohmi's [verification efficiency](../../../../docs/engineering/verification-efficiency.md) and
[existing acceleration plan](../../../../docs/superpowers/plans/2026-08-26-ci-hardening-and-acceleration.md)
own the adapted verification policy and staged future work. The plan keeps reported chat failure
patterns, multi-run measurements and a single experimental CI comparison separate. Historical evidence
does not prove current readiness or justify blanket claims that retries or subagents are wasteful.

## Evaluate the instructions without launching work

Read these cases against the skill and canonical contracts. They are review scenarios, not automated
runtime tests or proof a host tool works.

| Scenario | Required decision/evidence |
| --- | --- |
| Assigned oversight outcome is reviewed and verified | Outcome owner self-reviews and performs normal protected merge under Cooper's standing scope; independent review and protections remain required |
| Necessary bounded prerequisite blocks assigned outcome | Track, repair, review and verify it within inherited scope; no separate merge-permission question |
| User explicitly requests only a draft or no merge | Honor that narrower limit; standing authority does not override it |
| Routine implementation choice is unspecified | Choose a reasonable scope-consistent default; ask only for indispensable missing information or explicit platform approval |
| Existing owner is idle with unpushed work | Inspect and preserve work; idle is not abandonment or permission for a replacement writer |
| Dispatch creation times out | Reconcile partial creation by identity before retry; report uncertain, not acknowledged |
| Single-owner feature | One owner/branch; no additional supervisor or mandatory composition worker |
| Stable reviewed prerequisite is unmerged | Assess exact source/merge milestone; source integration can proceed only on authorized stable base |
| Shared contract changes | Identify existing transitive consumers and fixtures before final freeze; preserve one shared-path owner |
| Focused check passes but full stages are absent | Report partial execution; no full readiness, including a docs-only shipping candidate |
| New failure after older pass or input changed mid-run | Reject stale evidence; diagnose and rerun affected checks; do not mask failure with cached green |
| Runtime is healthy but fixture state cannot be fingerprinted | Preparation may be reusable after identity checks; test results need fresh execution |
| Scheduled wake unchanged, or user muted it | Default short nohmi report; preserve explicit mute/quiet and existing cadence; no new schedule |
| No saved monitor exists when yielding | State bounded wait or user-driven follow-up; never promise automatic monitoring |
| Source unavailable during reset | Partial reset; preserve decisions, grants, pauses, last verified state and unfinished obligations |
