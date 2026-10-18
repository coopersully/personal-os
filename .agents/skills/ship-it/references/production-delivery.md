# Production delivery after merge

A merged PR is terminal only for the merge operation. Retain delivery ownership until AC-07/08
are satisfied. Record the original reviewed source head/base and the observed squash merge commit;
do not replace the reviewed source head with main and accidentally reuse review receipts.

1. Save phase `deploy` and inspect the configured production controller via the read-only
   personal-os-deploy-status skill. Record actual deployed SHA, eligible push CI and controller
   receipt. Verify the merge commit is contained in that revision and the change remains present;
   ancestry alone does not prove it has not been reverted. Never wait for moving main to equal an
   old commit when a verified descendant already contains the change.
2. Save phase `observe`. Check health and each criterion agreed in the acceptance productionPlan.
   Each criterion has a documented expected outcome, safe probe, owner, and any observation window,
   traffic requirement and reset condition. Bind results to the deployed revision. A healthy app
   without revision evidence is unknown; absence of traffic/log errors cannot satisfy an observation.
3. Pending deployment/observation uses the existing bounded waits and same-owner wakeup. Poll only
   the pending provider; do not rerun local verification or request another review on an unchanged
   candidate. Controller failure or unavailable provenance is a specific blocker. Diagnose before
   retrying; never mutate production just to make the receipt green.
4. Reconcile Linear only to the full issue acceptance scope. Save the sanitized state described in
   acceptance-state.md. Run `python3 .agents/skills/ship-it/scripts/acceptance.py --state <state.json>`.
   `WAIT` retains ownership; `BLOCK` requires evidence/recovery. `SHIPPED` requires production proof
   and reconciliation. `COMPLETE_NO_DEPLOY` applies only to independently reviewed non-runtime scope.
5. Save phase `complete` with the full `delivery` snapshot. checkpoint.py evaluates it before accepting
   completion. Release the PR claim and pause only its dedicated heartbeat afterwards. Retain the
   private evidence; cleanup remains separately authorized and must preserve other work.

Re-read deployment/health and observation evidence before completion; if the deployed revision
changed, refresh affected criteria. Evidence references must include collection times, revision,
probe result and observation interval where applicable. The evaluator is offline: source references
and asserted provider facts must be inspected, not trusted because a model generated JSON.

For docs/tooling changes with no runtime deployment, the independent review must record why AC-07
is not applicable and any alternate distribution acceptance (for example, updated checkout/policy
reload) in productionPlan evidence. Do not call those changes deployed to production.
