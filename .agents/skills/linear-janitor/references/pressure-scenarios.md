# Linear Janitor Pressure Scenarios

| Scenario | Required behavior |
| --- | --- |
| Explicit PR number has one match and the issue lacks a link | Propose the exact PR link. |
| Unique recent branch exists with no PR | Propose the branch link and `In Progress` when currently unstarted. |
| PR merged but issue-specific completion evidence is incomplete | Report for review; do not mark `Done`. |
| Two PRs plausibly match | Do not write. |
| Completed issue links an open PR | Do not reopen automatically. |
| Query has another page | Fetch it before reporting counts or changes. |
| No current cycle | Use the 30-day recent scope; do not create a cycle or report failure. |
| Interactive user has not replied `confirm` | Preserve the dry run; do not write. |
| Similar branch or issue belongs to another Project | Exclude it and report the isolation collision. |
| The `Nohmi` Project is missing or ambiguous | Stop before candidate mutation and report the configuration gap. |
| PR Work map links the issue, but Linear has no structured PR backlink | Propose the exact structured link; do not treat a comment URL as sufficient. |
| Linear links the PR, but the PR Work map omits the issue or names another Project | Report GitHub-side drift; do not edit the PR. |
