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
  "codeRabbit": {
    "headSha": "<PR head SHA>",
    "status": "SUCCESS",
    "actionableFindings": 0,
    "coverageVerified": true
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
    "codeRabbit": ["coderabbit-coverage.json"],
    "feedback": ["feedback.json", "feedback-ledger.json"],
    "selfReview": ["independent-review.json"],
    "linear": ["linear-audit.json"],
    "metadata": ["metadata-audit.json"],
    "merge": ["github.json#sources/repository", "server-gates.json"]
  }
}
```

Determine expected required checks from live branch protection/rulesets, not from the checks that
happen to appear. Include every reported current-head CI check. Optional `NEUTRAL` or `SKIPPED`
checks may be marked `required: false`; a required check satisfies the gate only with `SUCCESS`.

Set `codeRabbit.status` to `SUCCESS` only when the integration's current review/check covers the
current diff and no actionable CodeRabbit item remains. A historical review on an earlier head is
not enough by itself. Use `PENDING` while a requested current review is running and `MISSING` when
the repository supplies no usable evidence.

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
CodeRabbit evidence includes verified integration identity, substantive coverage, candidate, review
source, and finding dispositions. A green skipped check is insufficient. Pending coverage may be
false while status is PENDING; missing review returns remediation to request it once.

All counts are actual collected counts, including outdated unresolved threads. Zero actionable
findings does not imply zero unresolved threads. Missing approvals return WAIT. Required approval
policy comes from live rules; when no approval is required, explicitly record that evidence.

## Hosted verification mode

`verification.mode: "hosted"` may replace `pnpmVerify: SUCCESS` only under the canonical
[delivery verification contract](../../../../docs/engineering/delivery-verification.md).
Set `equivalenceVerified: true` after comparing commands/configuration, with `equivalentChecks`
mapping `repository`, `lint`, `types-tests-coverage-builds`, and `browser` to the successful
four distinct current-head CI stage check names; a shared aggregate cannot fill multiple rows. These names must also appear in expected required/selected checks
with their provider IDs. Set `localOnlyComplete` only after any additional native/platform or
issue-specific requirements pass. Record each attempted local failure in `localFailures` with
`classification` (`fixed` or `environment`), an `evidence` reference, and successful
`focusedReproduction`. Unknown failures block equivalence. An explicit pnpmVerify FAILURE requires at least one diagnosis record. The evidence map must include the
workflow revision, configuration comparison, workflow-run PR/head/base association, and failure diagnosis records; do not invent them.
