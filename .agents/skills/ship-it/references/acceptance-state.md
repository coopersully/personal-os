# Independent acceptance and delivery state

Use the same sanitized state as readiness, adding `acceptance` and the separately retained `reviewedProductionPlan` below. The canonical inventory is
`docs/engineering/acceptance-policy.json`. `acceptance.py` loads it once per CLI invocation and
exports `POLICY_DIGEST`, a SHA-256 of the policy inventory, acceptance contract, code standards and
placement rubric joined by NUL in that order. Record that digest when review begins. A changed
policy requires a new assessment; copying a new digest into old evidence is not validation.

```json
{
  "reviewedProductionPlan": {
    "required": true,
    "owner": "<delivery owner>",
    "criteria": ["<stable criterion ID>"],
    "evidence": ["production-plan.json"]
  },
  "acceptance": {
    "policyRevision": 4,
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

A required runtime plan may instead retain a detailed reviewed schema: `candidateHead` and
`candidateBase` must match the current reviewed PR; `premerge_evidence` must be a nonempty array
of nonblank references; and `criteria` must be a nonempty array of objects. Every object needs a
unique nonblank `id`, a nonblank `action`, and `result` equal to `planned` or
`pending_post_merge`. Optional criterion `evidence`, when present, is a nonblank reference or a
nonempty array of nonblank references. The owner remains required. Mixed string/object criteria,
missing evidence, malformed bindings and detailed non-runtime plans are rejected.

The full detailed object must equal the independently retained snapshot, including actions,
safety limits and extra metadata. Validation never normalizes or rewrites either snapshot; only
validated IDs are derived in memory to match production observations. Premerge references do not
satisfy postmerge production criteria. Canonical string-ID plans still require top-level
`evidence`, with the existing non-runtime rules unchanged.

For historical recovery retention, these same schemas select different reference fields: legacy
string-ID plans retain top-level `evidence`; detailed plans retain `premerge_evidence`. A detailed
plan's optional top-level `evidence` remains extra metadata and never becomes an alternative or
additional freeze-reference list. Per-criterion evidence paths remain planned observation
locations, not required premerge files or successful production evidence. Selection is nonmutating
and candidate-bound; the exact original object, extra fields and digest remain intact. Entry and
history replay use the same selector; see [execution and recovery](execution.md#reviewed-plan-recovery-before-merge).

VERSION 8 recovery can explicitly retain typed per-file provenance without changing this
independent acceptance schema or policy revision 4. Historically hash-attested files retain their
original proof; freshly reviewed exact bytes with unavailable historical proof retain that distinct
classification, actual aware review time, author/reviewer separation and continuity/path references.
Neither class nor retained bytes satisfy readiness or production observations. Later retention
preserves unavailable original origins; a historical claim for the same path/hash needs an explicit
independently accepted newer predecessor-freeze binding, never flat relabeling of the old unknown
freeze. The immutable earlier declaration remains unavailable. Entry/history share
the versioned validation; pre-VERSION-8 history extras remain opaque and unchanged. See the
[typed recovery contract](execution.md#typed-file-provenance-version-8). The acceptance owner must
authenticate these underlying review/provenance assertions; helper validation cannot do so.

Before final collection, save the independently reviewed plan into the PR checkpoint's
`reviewedProductionPlan` with phase `final_check`. The checkpoint freezes that snapshot and refuses
replacement, including after reopening a phase. Read it back into readiness/delivery state; do not
reconstruct it from a changed post-merge plan. Readiness and delivery evaluators require exact plan
agreement. Completion also compares against the checkpoint's frozen snapshot. The freeze is a
cooperative integrity check, not authentication. A material plan change after freeze is a blocker
requiring explicit reviewed recovery; never overwrite/delete the checkpoint to bypass it.

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
