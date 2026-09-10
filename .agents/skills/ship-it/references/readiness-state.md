# Readiness State

Create `.context/ship-it/state.json` from freshly re-read, sanitized evidence. All `headSha` fields
must equal `pr.headSha`; never copy a prior decision forward after a push or base change.

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
    "expectedRequiredChecks": ["CI required", "PR Work map"],
    "expectedRequiredCheckApps": { "CI required": 15368, "PR Work map": 15368 },
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
    "adminMergeAllowed": false,
    "adminBypassOnly": false,
    "autoMergeAllowed": true,
    "squashAllowed": true
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

Set `adminMergeAllowed` only after live repository permission and protection/ruleset inspection
proves actor authority and a permitted bypass. Set `adminBypassOnly` only when the remaining normal
merge block is exactly that bypassable mechanism. These fields never describe readiness.
