# Finance Automations leaf

`FinanceAutomationsPage` is the Finance-owned leaf composition. Routing and navigation remain
owned by the workspace shell. It reuses the immutable `HostPromptPanel` for stored prompt text,
version history, explicit issuance, and exact recopy.

The current registration contract supports Codex desktop recurring intervals and Claude event
routines, using an existing connection with Finance maintenance scope. Registration records an
expectation; the person creates the external host job separately, then binds its real identifier.
Binding, name changes, cancellation, revocation, and trigger-token saves retain server version
fences. No new connection grants are created by the page.

Schedule health and grace thresholds come from the server. Event and nonactive registrations have
no next-run countdown. A host observation is explicitly distinct from successful maintenance.
The current host-status contract supplies no last-start or last-success history; those timestamps
must not be inferred from observations or registration edits. The current update API supports
names only: calendar cadence and pause/resume controls need a separate backend contract.

Owner-level readiness describes overall Chat availability. The host readiness endpoint describes
only the selected registration's actual message proof and current authority. Verification issues
a real server challenge and gives the original authorized host the MCP exchange instructions.
The human UI never performs that exchange, and copying cannot establish proof. Manual readiness
checks reread both projections without background polling. Issuing a replacement challenge resets
and refetches host and aggregate readiness, including owner-qualified Chat caches, because the new
challenge supersedes earlier proof. A failed readiness refresh preserves the issued instructions
and clears stale verified claims. Saved instruction descriptions make no Chat proof claim.
Verified message capability remains
separate from execution authorization and maintenance success.

Discrete actions update one Sonner toast from pending to the confirmed result or failure. Failed
forms and verification instructions retain their drafts. Initial read errors use the shared
settings feedback context, with Sonner retry controls and no inline error duplication.

Focused coverage lives in `automations-page.test.tsx`; exact stored prompt behavior remains covered
by `host-prompt-panel.test.tsx`. Browser inspection, integration authorization evidence, independent
review, and complete candidate verification remain required before delivery acceptance.

## Durable workspace setup through MCP

Initial agent guidance retains `get_finance_playbook` and `setup_finances` for canonical financial
values, then uses `get_finance_onboarding` to read the actual durable workspace review. The agent
saves returned question IDs and the exact revision with `save_finance_onboarding_answers`, then
calls `complete_finance_onboarding` using the saved revision when the server's blockers are resolved.
Only the returned `completedAt` confirms completion; legacy access and registered hosts are not
completion receipts or Chat proof.

The read requires Finance read scope and creates no state. Both mutations require current Finance
write and execution authority and standing owner execution permission for agents, rechecked before
replay. Input schemas preserve actual revisions, bounded unique questions, explicit unknown/none
semantics and actor-bound idempotency. No caller may supply an owner, actor, bypass, scope or
completion timestamp. An answered disposition requires a current canonical answer, and none is
accepted only where the returned question allows it.

Choosing later requires no automation registration. Choosing now requires an actual authorized
registration with cadence, while Chat verification remains an independent protocol. Onboarding
completion neither requires nor grants budget approval; financial activation retains its separate
exact human-approval boundary. The initial prompt and the server-issued host prompt serve distinct
setup stages and never invent a registration identifier or verification result.
