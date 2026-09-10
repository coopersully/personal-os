# Linear Work Sync Pressure Scenarios

Use these when refining `linear-work-sync`.

| Scenario | Required behavior |
| --- | --- |
| PR URL matches one issue; similar nouns match another | Update only the exact PR match; record the skipped candidate. |
| No active cycle exists | Continue; leave cycle unset. Do not report the current Nohmi setup as broken. |
| Source requests a nonexistent review status | Use the least advanced compatible live status; do not create taxonomy. |
| Two active issues plausibly match | Skip or ask; never create a third issue. |
| Branch/PR inspection without Linear write authority | Report coverage and proposed changes without mutating Linear. |
| More than 10 candidate issues | Return a plan and ask before batch creation. |
| Source contains secrets or personal data | Redact before planning, comments, or audit output. |
| Exact-looking issue belongs to another Project | Report the collision and make no mutation. |
| The Nohmi Project is missing or ambiguous | Fail closed; return the proposed work without writing. |
| Exact-looking issue has no Project | Report the collision; never adopt it implicitly during repository sync. |
| `create-pr` finds an exact Nohmi issue but the branch and draft body omit it | Reuse the issue, return its exact key/URL for both, and do not create a duplicate. |
| PR URL becomes available only after creation | Run the post-PR phase and add a structured backlink to every direct issue. |
| PR URL appears only in a comment | Add the structured link; do not count the comment as complete coverage. |
| One PR advances multiple direct issues | Use one primary branch key, list every issue in the Work map, and backlink the PR from each issue. |
| Open PR requests a nonexistent review status | Keep the issue `In Progress`; do not create taxonomy. |
