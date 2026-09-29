# Finance playbook implementation plan

1. Add the versioned domain registry, source lineage, web-research policy, and
   pure uncertainty-aware assessor.
2. Add the API composition service and authenticated read route, then expose it
   through the typed client and thin MCP adapter.
3. Surface the governing version in setup and maintenance protocol outputs.
4. Add a concise overview presentation that shows the hierarchy and the first
   unresolved blocker without hiding loading/error state.
5. Add unit and seam tests, run focused Finance tests, then `pnpm verify`.

The branch is stacked on PR #157 and should be rebased onto `main` after that
prerequisite lands, preserving migration and account-semantics ownership.
