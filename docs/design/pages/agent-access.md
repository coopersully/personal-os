# Agent controls and Reviews

Agent work has three distinct user questions. nohmi gives each one a dedicated destination.

## Contextual Reviews

Reviews answer **What needs my judgment now?** Open the contextual flow from a workspace alert or
its Settings header action. The flow stays within the selected workspace and renders the owning
domain's decision material, actions, progress, deferral, and status refresh. See
[Reviews](reviews.md) for the current contract.

Direct navigation to `/reviews` redirects to `/settings?section=profile`; it does not open a
cross-workspace queue or use Today navigation. Setup state remains separate from review and
attention work. Owner-scoped previews retain concrete questions, rule conditions and future
actions, Finance transaction evidence, and reported blockers. Missing evidence stays absent and
partial source failures stay visible. Agent feed redaction remains unchanged.

## Connected agents in Settings

Settings → Connections → Connected agents answers **Who can act in nohmi?**

- Show the current MCP URL once, with a copy action.
- List OAuth hosts and local/manual credentials separately.
- Show exact plain-language permissions, recent-use state, and a direct revoke action.
- OAuth is the recommended connection; personal tokens are an explicit fallback.
- `automations:read` is displayed as **Read daily brief** for compatibility.
- `automations:write` is not offered on new tokens. If an older token contains it, label it as a
  legacy inactive permission rather than implying authority.

Provider credentials remain in nohmi. Revoking an agent must not end human sessions or revoke a
different host.

## Workspace access overview in Settings

Settings → Security & access → Workspace access answers **Where can agents act, and where does configuration need attention?**

The selected workspace is stored in the URL. Mail, Calendar, Tasks, and Finances each summarize:

1. Allowed actions.
2. Actions requiring signed-in approval.
3. Actions nohmi does not permit.
4. Whether access covers all connected sources or a provider-selected subset.
5. Connected-host authority and domain readiness.
6. The current server-owned setup step and a direct link to the workspace's canonical settings.

This centralized surface is a read-only cross-workspace overview. Every workspace-owned access,
source, maintenance, override, rule, learning, recovery, and data control is edited inside the
owning workspace; centralized Settings must not render a duplicate form. Connected-agent
credentials and scopes remain global and editable in Settings → Connections → Connected agents.

Do not imply per-source credential scope when the credential model is workspace-wide. State that
limitation explicitly. Readiness is evidence, not a progress percentage. Use the stable phases
Checking, Not set up, Needs review, Set up, and Unavailable.

Mail owns proposed and active Mail rules. Proposed rules remain disabled until a signed-in person
completes a fresh review of the current bounded sample in Mail settings, tied to the exact preview
version. Proposal or sample drift invalidates activation. Permanent deletion remains unavailable.

## Visual standard

These pages are flat and quiet. Separate related regions with spacing and contrasting surface
colors. Do not use gradients or shadows. Use borders only for controls or boundaries that would be
ambiguous without them. At most one primary raised region should compete for attention.

## Legacy routes

`/settings?section=agents` and `/settings?section=automations` redirect to Workspace access while
preserving relevant workspace and rule parameters. `/automations` also redirects there. There is
no generic routine-management UI or public routine API.

The current centralized Workspace access implementation may still contain editable domain controls
until the target placement above is implemented. Code and the implementation log remain the source
of truth for that shipped transition.
