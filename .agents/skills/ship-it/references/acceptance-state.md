# Independent acceptance and delivery state

Use the same sanitized state as readiness, adding `acceptance` below. The canonical inventory is
`docs/engineering/acceptance-policy.json`. `acceptance.py` loads it once per CLI invocation and
exports `POLICY_DIGEST`, a SHA-256 of the policy inventory, acceptance contract, code standards and
placement rubric joined by NUL in that order. Record that digest when review begins. A changed
policy requires a new assessment; copying a new digest into old evidence is not validation.

```json
{
  "acceptance": {
    "policyRevision": 3,
    "policyDigest": "<POLICY_DIGEST from acceptance.py>",
    "headSha": "<reviewed source head>",
    "baseSha": "<reviewed base>",
    "implementers": ["<actual host/task identity>"],
    "reviewers": ["<independent host/task identity>"],
    "standards": [
      {"id": "CS-01", "result": "pass", "rationale": "<scope and conclusion>", "evidence": ["review.json#CS-01"]}
    ],
    "productionPlan": {
      "required": true,
      "owner": "<delivery owner>",
      "criteria": ["<stable criterion ID>"],
      "evidence": ["production-plan.json"]
    }
  }
}
```

The abbreviated standards list must contain every inventory ID exactly once. Each row needs a
nonempty rationale and real evidence reference, even for not_applicable. Evidence identifies the
reviewer/lane, inspected sources and consumers, relevant tests and their results or gaps. All
required concerns must have independent coverage. Identity strings are not authentication: the
owner verifies reviewer provenance and disjointness from all implementers, including repair authors.
`selfReview` remains a legacy readiness field for compatibility and cannot replace this record.

A failed eligible standard may carry `exception` with `id`, `approvedBy`, `authorityEvidence`,
`scopeEvidence`, `containmentEvidence`, `owner`, `issue`, `expiresOn` (ISO date), and `exitCondition`.
Evidence fields are nonempty arrays of references. The validator rejects incomplete results,
self-approved/expired exceptions and non-exception standards. The owner must additionally inspect
human/delegated approval, exact scope, direct Nohmi issue eligibility and any release-milestone expiry.
The code cannot authenticate these assertions. Never use exceptions for unknown evidence.

productionPlan evidence defines each ID's expected result, safe probe, owner, observation window,
required traffic and reset conditions where relevant. For independently reviewed non-runtime scope,
use required=false, criteria=[], and a nonempty reason; record alternative distribution requirements
in evidence. Do not remove criteria after merge to obtain a passing result.

## After merge

Retain the reviewed head/base in `pr`, set its state to MERGED from live evidence, and add:

```json
{
  "mergeReceipt": {"sourceHeadSha": "<reviewed head>", "mergeSha": "<observed squash commit>", "evidence": ["merge.json"]},
  "production": {
    "deployedSha": "<actual production revision>",
    "containsMerge": true,
    "changePresent": true,
    "deployment": "SUCCESS",
    "health": "SUCCESS",
    "evidence": ["controller.json", "health.json", "ancestry-and-change.json"],
    "criteria": [{"id": "<planned criterion ID>", "status": "SUCCESS", "deployedSha": "<same deployed revision>", "evidence": ["observation.json"]}]
  },
  "reconciliation": {"complete": true, "evidence": ["linear-and-ownership.json"]}
}
```

Every planned criterion must occur exactly once with evidence for the deployed revision. PENDING
keeps delivery waiting; failure/unknown blocks. Production evidence is omitted only for the reviewed
non-runtime case. Observe production immediately before completion; record timestamps and actual
intervals/probes in the referenced receipts. Later deployments invalidate affected observations.

Run `python3 .agents/skills/ship-it/scripts/acceptance.py --state <delivery-state.json>`.
Its decision is authoritative only as an offline policy calculation over inspected evidence, not
proof that external facts are true. Save the full state as checkpoint payload `delivery` with
phase=complete; the checkpoint rejects absent or unsuccessful acceptance. Pending external
mutations still must be reconciled before completion. No scripts merge or deploy automatically.
