# Delivery verification

Ship one frozen candidate with complete evidence. Use [verification efficiency](verification-efficiency.md)
for focused iteration and [acceptance](acceptance-contract.md) for review/production gates. This contract applies to ship-it and its
create-pr, catchup, review-remediation, and network callers. Focused checks run during implementation;
full verification runs after review findings converge. A full run against a changing checkout is
not acceptance evidence. Stage and commit the candidate before starting it; keep external metadata
and private evidence outside the source tree.

Draft publication and early review require focused evidence, not a separate full run. This sequencing
applies to ordinary contributions as well as handoff/network callers; see the
[development handbook](development-handbook.md). Complete readiness requires the verification scope
below plus independent review, live metadata/security/protection gates and issue-specific acceptance.
A successful selected job alone never establishes readiness.

## Git-verified prose-only scope

The only narrow final exception is a nonempty diff containing regular non-executable Markdown
additions/modifications in the classifier's explicit repository-prose allowlist: root README,
AGENTS and CONTRIBUTING; docs engineering/architecture/design/product Markdown except the generated
workspace-agent-tools dictionary; skill SKILL.md and direct references/*.md. Published app skills,
script fixtures, generated/runtime inputs, other extensions and unknown paths are not prose scope.
New transitive consumers require revisiting this allowlist, not silently treating their input as prose.

Run `node .github/scripts/ci-scope.mjs --base <base-sha> --head <head-sha> --json` against the
actual frozen checkout. The classifier inspects the complete Git diff, file modes and base ancestry.
Missing/malformed/unavailable evidence, mixed/global changes, renames, deletions, symlinks and mode
changes select full scope. Plain path lists are iteration advice and cannot authorize an exemption.
CI uses this same classifier; its strict aggregate requires every declared dependency and actual
success for every selected job. Only unselected jobs may skip. `ci:full` still forces all jobs.

On supported branch pushes, CI uses `--github-push` to read the GitHub-generated event file and
bind its repository name/ID, branch ref and immutable after SHA to the GitHub runtime context,
workspace and actual checked-out HEAD. The event's before SHA must be an available ancestor.
It classifies that entire before-to-after range; it never
substitutes `HEAD~1`, a merge base or a payload filename list. Missing, zero, malformed, mismatched
or unavailable identity/history, new/deleted branches, forced updates and unsupported events stay
full scope. The existing PR base/head path and strict selected-job inventory are unchanged.

The push boundary uses existing GitHub Actions context and local Git only, with no new network
request or credential. Payload input is a descriptor-verified regular file, read nonblocking and
bounded to 1 MiB; uncertain, oversized or malformed payloads select full scope without logging
payload excerpts. The checked-out HEAD lookup is bounded to 15 seconds within the existing
five-minute classification job. Caller-supplied local JSON/context is not authentication: actual
hosted event provenance, resulting scope and selected success remain rollout evidence. Push runs
still skip PR-only source receipt steps and have no PR metadata requirement; downstream release
controllers retain their existing policies. Narrow push classification alone claims no deployment
or measured time/billing savings.

For `prose_only: true`, Repository contracts (including classifier/evaluator regressions and
repository prose contracts), Classify changes and Source verification must succeed in the same
current-head/base source workflow run/attempt. Preserve separate metadata, security, review,
provider and protected-merge gates. Record the full classifier JSON, workflow revision and provider
run identity; use readiness `verification.mode: "prose"` as described in its state reference. The
evaluator recomputes scope from Git at the actual candidate checkout and requires those source jobs
from that recorded attempt. Inspect the source run's PR/head/base association; offline validation
cannot authenticate provider receipts. An unavailable checkout/Node/Git blocks narrow acceptance.
No application compilation, coverage, browser/native run or duplicate local full verifier is required
for this proven scope. Content/link review and applicable instruction adoption remain required.

Every other shipping candidate requires complete local or equivalent hosted verification below.
This includes classifier/workflow/evaluator/dependency/configuration changes, tool scripts, and
changes whose transitive impact is uncertain. The CI/enforcement change introducing this exception
must itself pass full verification; its later prose consumer must prove the narrow hosted path.

## Verification equivalence

`pnpm verify` remains the complete local verifier. For shipping, current-candidate hosted CI can
satisfy equivalent stages without a duplicate local full run. Record the exact head, base/integration
context, workflow revision, provider, run/attempt, command/configuration, result, and source URL.
Compare the workflow against the candidate's verifier inputs; check names alone are insufficient.

| Local stage | Hosted equivalent |
| --- | --- |
| `pnpm check:repo` | Repository contracts |
| `pnpm lint` | Lint and format |
| `pnpm check:node` (types, coverage, builds) | Node quality |
| `pnpm test:e2e` | All four Browser acceptance shards for **each** of desktop-chromium and mobile-chromium |

Every row must name distinct stage jobs, include every matrix member, and be successful for hosted full equivalence, even if scoped CI omitted
an unaffected stage. Omission is not evidence: if any core hosted stage is missing, use the
complete local verifier. Native/platform, live-provider, and issue-specific acceptance remain
additional requirements when relevant. Preserve all coverage floors, assertions, and required checks.

A local failure must be diagnosed before hosted evidence can replace its result. Record the trigger,
failure classification, source evidence, and focused reproduction/recovery result. A changed assertion
or unexplained failure is not an environment diagnosis. If the defect is real, fix and reverify the
new candidate. If isolated reproduction passes and evidence establishes runner contention, use
successful equivalent hosted gates; do not keep rerunning the whole local suite to obtain lucky green.

## Opt in to complete hosted verification

Apply the repository label `ci:full` to the PR before its next genuine opened, reopened, or
synchronize event (normally the final source or catchup push). CI reads the label from that PR
event payload and selects full scope: repository contracts, lint, Node quality, both browser
projects, Terraform, and the existing macOS/Windows native matrix. The normal PR merge checkout,
head/base association, read-only permissions, source aggregate and metadata gate remain unchanged.
Other PRs retain their classified scope.

Adding or removing a label alone starts no workflow, cancels no source run and supplies no evidence.
Do not create empty commits or close/reopen a PR solely to trigger CI. A retry retains its original
event payload: labeling an already frozen candidate and rerunning an earlier unlabeled event does
not opt it in. Use the complete local verifier when there is no genuine next candidate event.
Labels are operator-managed; CI neither creates nor applies them. Removing the label affects only
future genuine PR events and never cancels an existing full run.

A full-scope configuration is not successful execution. Collect every distinct successful job,
matrix member and exact candidate identity required above, then check the normal metadata gate.
Browser jobs allow 45 minutes including dependency downloads, with browser execution separately
bounded to 30 minutes. The metadata observer waits up to 55 minutes inside a 60-minute job so
source-job setup and aggregation can finish before its deadline. Individual test timeouts and
assertions remain unchanged.

Hosted capacity, permissions, provider outages and native dependencies can still block delivery.
Existing failure diagnosis and bounded retry rules continue to apply; a failed metadata gate after
source recovery needs the documented metadata rerun, not a PR-body edit.

## Bounded browser failure diagnostics

The browser matrix preserves the original test command, both projects and four shards, one worker,
configured single retry, 45-second case deadline and 30-minute job deadline. Existing Playwright
`retain-on-failure` traces and `only-on-failure` screenshots can remain after a retry succeeds.
Collection and upload therefore run independently of the terminal test-step result. No extra test,
retry, reporter, report regeneration or intentional full-suite failure supplies diagnostics.

Prepare binds a new runner-owned directory to the actual checkout/workflow/run attempt and matrix
member before installation. The one-minute collector reads only existing `test-results` attachments:
`trace.zip`, `test-failed-N.png` and `error-context.md` below a case directory. It rejects stale,
linked, special, changed, unsafe-path and over-budget input; Linux reads are anchored to opened
directory descriptors. It copies accepted bytes into exclusive staged files and publishes the
manifest last. The uploader sees only that staging directory, never raw `test-results` or the HTML
report tree. Prepare markers and pending files are outside the upload directory. Hidden files,
storage-state files, videos, environment dumps and arbitrary workspace files are excluded.

Fixed budgets are 64 MiB per trace ZIP, 8 MiB per PNG, 1 MiB per context file, 128 MiB accepted
attachments per matrix job, 64 files and a 64 KiB manifest. Traversal stops at 512 entries (exhaustion
is an explicit gap), four directory levels and 512-character relative paths. A rejected file is
excluded whole; no truncated trace is represented as usable. Signature/UTF-8 checks are only format
screening, not validation or sanitization of a trace's internal contents. These policy limits are
not a claim that an unavailable historical trace fits. Consumers bound the downloaded archive to
140 MiB, enforce the corresponding member/expanded bounds before extraction, and safely inspect
nested trace ZIPs without executing embedded content.

The seven-day artifact is named
`browser-diagnostics-<run-id>-<run-attempt>-<project>-<shard>`. Its manifest records actual checkout
and workflow SHA/file hash, repository/event, PR head/base where applicable, matrix/job identity,
prepare/collect time, original test-step outcome, per-file paths/bytes/SHA-256 and explicit gaps.
The source receipt is an unvalidated correlation reference: acceptance independently binds it to
the API run/attempt/job and tested merge. Workflow run attempt is not Playwright retry index.
Absent structured test identity/retry metadata stays `not-recorded`; directory names do not prove
that identity or the original body/cleanup outcome.

No emitted attachment produces a manifest-only result. This is observed absence, not proof that
every test passed first try, that reporting occurred, or that an earlier body failure did not exist.
The original test step's exit remains authoritative; successful diagnostics never clear a failed
source step. Diagnostic rejection or upload failure remains visible and may fail the job even if
the source step passed. Upload requires the collector's explicit ready output, including on a
nonzero collection result with a safely published incomplete manifest. A failed preparation,
unsafe staging, cancellation, job deadline or runner loss can prevent any artifact.

### Browser content and audience boundary

Raw traces are **not sanitized**. They can contain fixture sessions, DOM snapshots, network
headers/bodies and source files. The current repository is public; signed-in users with repository
read access can [download Actions artifacts](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts). Seven-day expiry is retention, not private access
control. Keep raw artifact contents out of issue comments and public PR prose; report only bounded
sanitized identity/count/hash/gap metadata there.

The reviewed browser workflow declares `local-e2e-fixtures`, supplies no provider secret inputs and
does not increase Actions permissions. The harness starts loopback services and a temporary
PostgreSQL database populated with QA fixtures. Its child processes inherit their environment;
those static facts alone do not prove that every trace is free of production credentials or
provider data. The collector requires that declared context but does not claim to attest it or
redact payloads. Before publishing a retention change, the owner must establish the actual CI
fixture/environment and artifact audience boundary and review representative fixture content.
Production sessions/provider secrets are outside this capture contract. An unestablished boundary
is a publication gap, not a reason to broaden capture or silently claim sanitization.

Focused synthetic fixtures cover retry-success retention, sticky original failures, absence,
unsafe/stale/oversized input and workflow gating. They do not replace genuine hosted upload and
once-downloaded artifact identity/digest/retention/content evidence. Verify seven-day service
expiry and creation against the actual successful upload interval, not an assumed exact start.
A clean run can prove empty-manifest transport only; actual retry-trace delivery needs a naturally
observed failed attempt. This CI-only change cannot recover a missing historical trace, explain an
unobserved Finance timeout, or waive a consuming workstream's incident acceptance. Finance owns
its test/body/cleanup repairs; the consuming workstream retains its acceptance decision.

## Bounded Node coverage diagnostics

Node quality prepares an attempt-owned marker before install/audit/checks, then always attempts
collection without changing the original `pnpm check:node` command, exit handling, coverage floors,
report-on-test-failure behavior or job deadline. The JSON reporter adds exact per-file Istanbul
maps and counters alongside the existing reporters. Completed reporters run before threshold
checking; failing tests with `reportOnFailure=false`, or earlier failures, can leave no reports.
Absence produces a truthful manifest, never regenerated reports, rounded or zero-filled counters,
or a guessed type/test failure stage.

The seven-day `node-coverage-<run>-<attempt>-<job>` artifact allowlists only `manifest.json`,
`coverage-summary.json` and `coverage-final.json`. Accepted report files are unchanged bytes with
SHA-256 digests. The summary is limited to 1 MiB, the detailed map to 64 MiB and accepted reports
to 65 MiB combined; the manifest is at most 64 KiB. These are fixed design budgets, not a claim
that the current complete report fits or has measured headroom. The earlier 20 MiB cap rejected
a genuine detailed report; future source runs must establish actual accepted size and schema.
Artifact consumers cap the downloaded archive at 70 MiB and enforce the same member and expanded
total limits before extraction or parsing. A compressed archive never waives an expanded bound.
The collector rejects unsafe directories, symlinks, non-regular/hard-linked files, stale output,
malformed or unexpected coverage structures, external paths, embedded source maps and oversized
files. No workspace glob, HTML, source-rendered output, raw V8 temporary data, environment, event,
credential or stdout dump is uploaded. Whole rejected files are omitted rather than truncated;
the manifest records the gap and diagnostic failures remain visible. A `file_limit` rejection
includes `observedBytes` from the opened regular file's size before allocation or reading; it does
not claim a content hash. Other rejection reasons do not invent an observed size. Safe manifest-only
collection
can succeed while the original source step remains failed. Missing reports after Node success are
a diagnostic error. A failed preparation, cancelled runner or inability to safely stage a manifest
can leave no artifact; upload requires the collector's explicit ready signal.

The manifest binds actual checkout and workflow revisions, workflow file hash, repository, run,
attempt, job and known source-step outcomes. Outcomes do not supply numeric exit codes. A PR's
`source-candidate-<run>-<attempt>` name is a correlation reference only: the Node collector does not
fetch or validate that separate receipt. Push runs explicitly have no PR receipt. Diagnostic
artifacts never replace source-verification evidence; inspect actual provider identity, download,
content and digest on a genuine run before using them for diagnosis.

## Shared local capacity

`pnpm verify` enters `.codex/scripts/verification-runner.py` before expensive work. One verifier per
host/user holds an OS file lock at `~/.cache/nohmi/verification/verification.lock`, across repository
worktrees. Exit 75 means queued, not failed verification: persist the next trigger and retry after
release. The holder records PID/worktree/time. The child inherits the lock, so coordinator death
does not free a still-running child. Never delete the lock or kill another task to acquire it.
The OS releases ownership after all holders exit; stale text in the file is not a live claim.
Exit 78 means an uncommitted or changed candidate cannot supply acceptance evidence.

This guard coordinates updated callers only. Existing older worktrees and ad hoc `vitest`/Docker
runs do not join it. During rollout inventory active verifiers before admission; wait for existing
owners to finish. Do not claim host exclusivity while legacy runs remain active. Independent focused
checks may proceed when they do not contend for the constrained runner.

## Invalidation and recovery

| Change | Refresh |
| --- | --- |
| Source or verifier inputs change | Affected review plus verification/CI coverage for the new candidate |
| Base changes | Integration assessment, catchup when needed, and resulting candidate verification |
| PR title/body changes | Metadata/Work map validation only |
| Linear link/status changes | Tracker validation only |
| Approval or handled thread changes | Review disposition/approval gate only |
| Provider remains pending | No code or verification; wait on that provider record |

Allow one justified retry for a transient failure. A repeat needs a changed recovery condition,
such as isolated runner ownership, or an explicit blocker. Fingerprint by candidate, stage and root
cause, not test name: different timed-out assertions on an overloaded host are one incident.
Productive fixes are not limited by a pass count. A known failing candidate must not occupy the
runner while code is edited beneath it; stop only the owned run before edits.

## CI metadata isolation

`ci.yml` runs source checks on opened, reopened, synchronize, and supported pushes.
Its aggregate is `Source verification`. `pr-metadata.yml` runs on those PR events plus edits and ready-for-review and owns
`CI required`, preserving the existing protection name/provider. It validates the live PR Work map
and waits for the latest applicable successful source workflow for that PR on its exact head and base. Missing, pending,
failed, or canceled source runs cannot pass the gate. Each workflow has a separate concurrency group;
editing a description cancels only a superseded metadata gate, never source tests.

Stage A metadata observation retains polling and the single protected `CI required` context.
It validates the live PR body, not the historical event body, and requires stable PR head/base,
body hash and latest source run/attempt before accepting completed source evidence. Reads have a
120-second observation budget, 15-second command timeouts, at most three 100-row pages per
inventory and one bounded recollection for a changing PR/attempt. API read failure gets one retry
within that same budget. A trusted retargeted metadata event fails immediately until a genuine new candidate event;
run-association mismatches are negative stale hints, never positive provenance. The `ci:full`
decision comes from the original receipt event; editing the live label affects future events only.
The existing 55-minute polling deadline remains; pending source runs
only use lightweight identity/status reads, without repeatedly downloading artifacts.

The classification job uploads `source-candidate-<run-id>-<attempt>` under existing artifact runtime
authority. Its single `source-candidate.json` entry records original event head/base, repository/PR,
run/attempt, workflow/classifier digests and canonical scope; no PR body is retained. Metadata uses
its existing Actions read permission to bind the exact run artifact/digest, independently recomputed
scope and every selected job's actual current-attempt success. Archive input is capped at 64 KiB,
the one decoded JSON entry at 16 KiB; content is never extracted or executed. Receipts expire after
seven days. Missing, expired, malformed, foreign or stale receipts fail closed. Local fixtures do
not prove hosted artifact access: actual unchanged-token upload/download and attempt binding remain
explicit rollout evidence.

GitHub can regenerate a synthetic merge commit after an original-base restoration even when
its integrated content is unchanged. The immutable receipt retains its original merge/workflow SHA;
the observation retains the current live synthetic SHA. A mismatch permits no boolean override:
the observer performs two logical current-repository Git commit lookups (up to four requests with
the existing bounded retry), verifies both response SHAs/provider URLs, requires exactly the ordered
parents `[current base, current head]` in both objects and an identical valid tree SHA. Missing,
malformed, denied, unreachable, different-parent or different-tree evidence fails closed. All other
repository/PR/base/ref, original workflow/ref/digests, event/run/attempt, selected jobs and final
PR/body/attempt fences remain mandatory. A trusted retarget event still rejects immediately.
Normalized provider commit evidence accompanies the observation; readiness requires that complete
structure, both original/live identities and current PR tuple, never an unsupported equivalence flag.
It validates evidence bindings, not authenticity of caller-supplied JSON; inspect saved provider
responses and the actual collector. No receipt is rewritten and no new permission is introduced.

A failed-jobs-only retry that omits classification has no new-attempt receipt. Retry the complete
source run under the bounded retry policy, then recover metadata; never reuse another attempt's
artifact or start duplicate full suites automatically. The final evidence collector uses the same
observer, retains body hashes rather than body text, and readiness requires that exact successful
observation. Provider contexts alone do not establish PR or attempt identity. This strengthens
observation; it does not establish server-side invalidation of an older green commit-scoped context
on a same-head retry or isolate two PRs sharing a head. Separate-check protection migration and
polling removal remain unaccepted pending that proof and separate authority.

A failed/canceled source run fails its waiting metadata gate. A same-head source retry does not
trigger a new PR event: after source recovery, the shipping controller must rerun the failed/canceled
PR metadata workflow (`gh run rerun <metadata-run-id> --failed`) and wait for the new protected result.
Record both source and metadata run/attempt IDs under the existing bounded retry policy. Do not
edit the PR body to trigger recovery or reuse the failed metadata result. Ignored `.context` evidence
is excluded from source lint so collecting provider records cannot create a formatting failure.

Retargeting a PR changes its integration context: catch up to its actual base and push a new candidate
before merging. Do not reuse a successful run from a different target base. Final ship-it collection
still checks live metadata, head/base, source attempts, reviews, and protections before normal merge.

## Rollout and external evidence

Ship-it records its checked-in VERSION and the loaded policy revision in every checkpoint. Version
changes require re-reading the skill and this contract at a safe checkpoint, then re-auditing
candidate evidence. A merged instruction file does not update a running chat's memory or an old
worktree. Update the checkout and reload explicitly; never overwrite an active owner's local changes.

Fixture tests prove gate selection, lock contention, and checkpoint recovery. Hosted workflow runs
must additionally prove GitHub Actions read permission, source-run discovery, bounded waiting, and
required-check publication. Scheduler creation must be verified on its host; a checkpoint alone
cannot wake a chat. A provider outage, inaccessible fork run, or exhausted review quota can still
block delivery despite green local tests. Persist the exact gap and next trigger, never infer success.

## Ownership through production

The repository handoff skill owns delivery through production acceptance and reconciliation;
ship-it is its protected-merge engine and compatibility entrypoint. Keep all existing merge gates.
Use repository deep-review instead of the retired personal refine-pr workflow. A readiness verdict
of TERMINAL after merge ends only the merge operation. Retain the owner and dedicated wakeup until
the reviewed production plan is verified or explicitly blocked. Offline acceptance and checkpoint
validation do not authenticate provider evidence; inspect the recorded receipts.
