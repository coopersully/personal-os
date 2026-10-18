# Readiness State

Create `.context/ship-it/state.json` from freshly re-read, sanitized evidence. All `headSha` fields
must equal `pr.headSha`; never copy a prior decision forward after a push or base change.
Use the collector bundle plus live feedback/Linear and recorded local verification. The evaluator
requires source references but does not authenticate their contents; inspect each referenced record.

```json
{
  "pr": {
    "state": "OPEN",
    "isDraft": false,
    "headSha": "<40-character SHA>",
    "pushedHeadSha": "<same SHA>",
    "baseSha": "<fresh remote base SHA>",
    "mergeable": "MERGEABLE",
    "mergeStateStatus": "CLEAN"
  },
  "worktree": { "clean": true },
  "base": {
    "headSha": "<same base SHA>",
    "evidenceHeadSha": "<PR head SHA>",
    "headContainsBase": true
  },
  "verification": {
    "headSha": "<PR head SHA>",
    "focused": "SUCCESS",
    "pnpmVerify": "SUCCESS"
  },
  "ci": {
    "headSha": "<PR head SHA>",
    "rulesVerified": true,
    "inventoryComplete": true,
    "selectedChecksVerified": true,
    "expectedRequiredChecks": ["CI required"],
    "expectedSelectedChecks": [],
    "expectedCheckApps": { "CI required": 15368 },
    "checks": [
      { "name": "CI required", "headSha": "<PR head SHA>", "appId": 15368, "status": "COMPLETED", "conclusion": "SUCCESS" },
      { "name": "Optional aggregate", "headSha": "<PR head SHA>", "appId": 57789, "status": "COMPLETED", "conclusion": "NEUTRAL", "required": false }
    ]
  },
  "feedback": {
    "headSha": "<PR head SHA>",
    "collectionComplete": true,
    "unresolvedActionable": 0,
    "unresolvedThreads": 0,
    "requiredApprovalsSatisfied": true,
    "approvalsCurrent": true
  },
  "selfReview": {
    "headSha": "<PR head SHA>",
    "complete": true,
    "newVerifiedFindings": 0
  },
  "linear": {
    "headSha": "<PR head SHA>",
    "verified": true,
    "paginationComplete": true,
    "project": "Nohmi",
    "directIssueKeys": ["COO-123"],
    "workMapIssueKeys": ["COO-123"],
    "structuredBacklinksComplete": true,
    "statusesCompatible": true
  },
  "metadata": { "headSha": "<PR head SHA>", "consistent": true },
  "merge": {
    "capabilitiesVerified": true,
    "normalMergeAllowed": true,
    "serverGatesVerified": true,
    "squashAllowed": true
  },
  "evidence": {
    "base": ["github.json#baseSha", "ancestry.json"],
    "verification": ["verification.json"],
    "ci": ["github.json#sources/checks", "github.json#sources/rules", "selected-scope.json"],
    "feedback": ["feedback.json", "feedback-ledger.json"],
    "selfReview": ["independent-review.json"],
    "linear": ["linear-audit.json"],
    "metadata": ["metadata-audit.json"],
    "merge": ["github.json#sources/repository", "server-gates.json"]
  }
}
```

Determine expected required checks from live branch protection/rulesets, not from the checks that
happen to appear. Retain the complete raw check/status inventory. Include every reported current-head
CI/security execution check and every live-required or workflow-selected check in `ci.checks`.
An authenticated optional advisory review lifecycle status (such as CodeRabbit coverage) belongs in
feedback evidence, outside execution checks. Record provider/purpose and classification evidence;
never classify by display name alone or omit a required/selected check. Unknown classification
remains unresolved and blocks readiness. Advisory findings and threads
remain in the complete feedback ledger. Optional `NEUTRAL` or `SKIPPED`
checks may be marked `required: false`; a required check satisfies the gate only with `SUCCESS`.

CodeRabbit is optional advisory review. Its absence, rate limit or skipped coverage does not block
readiness. Collect and adjudicate actual bot feedback alongside all other review surfaces; unresolved
threads and verified actionable findings still block. Preserve any check required by live GitHub rules.
Independent deep-review acceptance below is mandatory regardless of bot status.

Set `serverGatesVerified` only from live enforcement of up-to-date required checks, required
approvals, and resolved conversations, for the normal protected merge path; never infer permission to bypass them. Set
`normalMergeAllowed` only from live actor authority and the normal protected merge path.
Administrator and deferred auto-merge fields are not supported; they never grant readiness.

Set `selectedChecksVerified` only after comparing workflow scope against the complete check
inventory. The required-check names from rules are a minimum; enumerate every selected scoped job in
`expectedSelectedChecks` (an explicit empty list only when none are selected). `expectedCheckApps`
maps the union of required and selected names to expected provider IDs. Every job in that union
must exist and succeed; optional skipped/neutral checks outside that union do not replace it. Normalize REST check status/conclusion to uppercase; map provider
identity and candidate SHA explicitly. Legacy commit statuses require equivalent authenticated
provider evidence; do not invent an app ID from a username.

Each check may carry positive integer `workflowId`, `runId`, `runAttempt`, and nonempty `event`.
Only an older attempt of the same name/provider/head/workflow/run/event can be superseded by a newer
attempt. Missing identity, same-attempt duplicates, or different runs stay ambiguous. For separate
replacement runs, inspect scope and preserve explicit supersession evidence before assembling a
single applicable inventory. A pending latest attempt must remain waiting. Do not infer attempt
identity from timestamps or blindly join all checks to the newest workflow run.

Evidence references identify saved sanitized records or exact source URLs. Every listed record
must exist and support the assertion. Verification records include candidate, base, verifier inputs,
command, exit status, and time; reviews include exact candidate, reviewer, findings and dispositions;
Linear records include live Project ID, issue IDs, current eligibility and acceptance revision.
All counts are actual collected counts, including outdated unresolved threads. Zero actionable
findings does not imply zero unresolved threads. Missing approvals return WAIT. Required approval
policy comes from live rules; when no approval is required, explicitly record that evidence.

## Independent acceptance

The example above is the existing merge evidence envelope. It is not sufficient alone: add the
current independent `acceptance` record from [acceptance state](acceptance-state.md). The evaluator
requires every current CS ID, policy revision/digest, source head/base, independent identities and
a reviewed production plan before MERGE. After merge, TERMINAL only prevents duplicate merging;
use the production evaluator before completion.

## Hosted verification mode

`verification.mode: "hosted"` may replace `pnpmVerify: SUCCESS` only under the canonical
[delivery verification contract](../../../../docs/engineering/delivery-verification.md).
Set `equivalenceVerified: true` after comparing commands/configuration, with `equivalentChecks`
mapping `repository`, `lint`, `types-tests-coverage-builds`, and `browser` to the successful
distinct current-head CI stage jobs. Each value is a job-name string or a nonempty list for a
matrix stage (for example, browser maps to both `Browser acceptance (desktop-chromium)` and
`Browser acceptance (mobile-chromium)`). Require every matrix member and never reuse a job across
stages or fill multiple rows with a shared aggregate. These names must also appear in expected required/selected checks
with their provider IDs. Set `localOnlyComplete` only after any additional native/platform or
issue-specific requirements pass. Record each attempted local failure in `localFailures` with
`classification` (`fixed` or `environment`), an `evidence` reference, and successful
`focusedReproduction`. Unknown failures block equivalence. An explicit pnpmVerify FAILURE requires at least one diagnosis record. The evidence map must include the
workflow revision, configuration comparison, workflow-run PR/head/base association, and failure diagnosis records; do not invent them.
