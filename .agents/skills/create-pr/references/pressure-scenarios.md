# Create PR Pressure Scenarios

| Scenario | Required behavior |
| --- | --- |
| Exact Nohmi issue matches the work, but branch and draft body omit its key | Reuse it; add its exact key to a new branch when possible and its link to the Work map. Do not create a duplicate. |
| No issue matches after a complete duplicate search | Create one concrete issue directly in Nohmi before publishing the PR. |
| Two active Nohmi issues plausibly match | Do not create or choose one silently. Keep the PR draft and report the ambiguity. |
| An exact-looking issue belongs to another Project or has no Project | Treat it as an isolation collision; do not update or adopt it. |
| The live Nohmi Project is missing or ambiguous | Make no Linear mutation, keep the PR draft, and report the configuration gap. |
| User explicitly says to skip Linear | Perform no Linear reads or writes, disclose the exception in the Work map and final result, and keep the PR draft unless the user directs otherwise. |
| PR URL does not exist during pre-PR sync | Complete issue resolution first, create the PR, then run the post-PR phase with the returned URL. |
| PR URL appears in an issue comment but not its structured links | Add the structured backlink; the comment does not satisfy coverage. |
| Live workspace has no review-specific status | Keep draft and open PR work `In Progress`; do not create taxonomy. |
| One PR advances multiple direct issues | Use one primary branch key, include every issue in the Work map, and backlink the PR from each issue. |
| Current branch already has an open PR | Refine and reconcile that PR; do not create another. |
| Required verification fails | Report the failure and keep the PR draft; never mark it ready or claim success. |
