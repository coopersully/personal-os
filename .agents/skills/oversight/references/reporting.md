# Useful status

Lead with a short judgment: what is progressing or whether Cooper needs to act. For every scheduled heartbeat, including unchanged checks, and substantive workstream status, use a compact table. Begin with a bold summary of ten words or fewer and one or two sentences about the priority and critical path:

| Workstream | Scope | Dependencies | Status | Latest | Next |
| --- | --- | --- | --- | --- | --- |
| Verified issue title/link and actual implementation checkout | Short workstream TL;DR | Linked prerequisite issue/workstream/branch, or ➖ | Concise evidenced phase | Concrete change | Owner + next action |

Include concise human-readable purposes with issue keys and PR numbers. Link only verified URLs and actual checkout paths; never substitute the oversight directory. Do not include an external-review column or infer a ready-for-review label gate. Report the project’s actual independent review and verification requirements. Do not invent mandatory human sign-off. Existing live protected-branch requirements still apply.

Use one leading status icon: 🧑🏼‍🏫 Planning; 🧑🏼‍💻 Building/Fixing; 🕵🏼 Verifying/Testing; ✅ for the milestone actually proven; ⏳ Waiting with its specific dependency or pause condition; ⚠️ for a genuine Cooper decision/access action; keep ❔ Unverified only as an internal evidence state, never a user-facing status. Use ➖ for an empty/no-change cell. Agent-owned repairs do not become Cooper decisions.

Follow with concise Open questions, Blockers and Up next bullets when applicable. State the actual decision, owner, recommendation and blocked behavior. Do not repeat answered questions or treat elapsed time as consent. Distinguish requested, acknowledged, merged, deployed and accepted.

Assess the whole agreed outcome, including unstarted and non-code work, rather than only open PRs. If reporting a percentage, use a deduplicated inventory of comparable deliverables with verified completed/total counts; retain completed work in the denominator and disclose scope gaps. Do not double-count parent/children or present task counts as effort progress. Estimate only from stated assumptions, remaining work, dependency order, useful concurrency, constrained verification and external waits. State the target milestone and uncertainty; no mandatory invented percentage or calendar promise.

Every scheduled heartbeat sends a user-visible report, including unchanged checks. This supersedes the earlier quiet-on-unchanged preference for this personal oversight workflow. An unchanged report states the actual ongoing work or concrete wait and next trigger; it does not manufacture progress. A failed or ineligible wake reports its actual check limitation without claiming a successful source refresh. Direct status questions get a response even when unchanged. Keep machine wrappers, hashes and detailed receipts out of user-facing prose; follow the host's actual notification protocol.


## Resolve evidence before reporting

Missing or stale evidence triggers investigation in the same pass: refresh the authoritative source, recover existing receipts, check the owning chat and use an available authorized alternate source. Route missing technical proof to the existing implementation owner; do not duplicate active verification. Keep successful prior evidence with its real timestamp while pursuing the gap.

Never send a generic Unverified row or stop at “evidence missing.” If bounded recovery cannot succeed, report the concrete failure, affected gate, responsible owner, recovery attempted and next action/trigger. Use Verifying/Testing while recovery is active, Waiting for a specific external condition, or Needs your decision only for genuinely unavailable human access or a decision. Do not conceal uncertainty or claim a gate passed. No endless polling or repeated blind retries.

Merge-ready candidates advance through the protected merge immediately. Report Merged after provider confirmation; if merging fails, report its specific blocker and recovery. A genuine serialization wait may briefly retain Ready to merge with the named queue owner/trigger, never “waiting for Cooper” solely for merge permission. Deployment and final acceptance remain separate milestones.


## Keep columns precise

- **Dependencies:** only actual prerequisite workstreams, issues, PRs or branches whose work must complete or become available. Name/link the concrete prerequisite and, only when useful, the needed milestone. Do not list the row's own verification, testing, review, approval or generic readiness gates as dependencies; those belong in Status or Next. Remove satisfied prerequisites. Use ➖ when no outstanding work dependency exists. Investigate unknown dependencies before reporting; describe a concrete recovery blocker if evidence cannot be obtained.
- **Scope:** one short, high-signal phrase or sentence explaining what this workstream changes or delivers. Give its TL;DR, not a requirements summary, implementation inventory or repeated title. Keep stable unless scope changes.
- **Status:** one icon and a few words naming the current phase, such as Building, Verifying, Merging or Waiting — Accounts. Put explanations, evidence and next actions in their own columns or the blocker footer; do not pack a narrative into Status.
