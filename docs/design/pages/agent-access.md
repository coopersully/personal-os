# Agent controls and Reviews

Agent work has three distinct user questions. Ilo gives each one a dedicated destination.

## Reviews in Today

`/reviews` answers **What needs my judgment now?** It is owned by Today and appears in the Today
sidebar and mobile dock.

- It contains only `review` and `attention` work. Setup state is never queue work.
- Kind and workspace filters are stored in the URL as `kind` and `workspace`.
- Results use cursor pagination with Previous and Next controls and an honest displayed range.
- Each row names its workspace, work type, title, explanation, and one direct action.
- Partial source failure stays visible; Ilo never converts unavailable work into a successful zero.
- An empty state says the available work is clear when some workspaces could not be checked.

Review actions route to the surface that owns the decision. Finance reviews stay in Finance. Mail
rule activation opens Settings → Workspace access → Mail with the exact proposed rule selected.

## Connected agents in Settings

Settings → Connected agents answers **Who can act in Ilo?**

- Show the current MCP URL once, with a copy action.
- List OAuth hosts and local/manual credentials separately.
- Show exact plain-language permissions, recent-use state, and a direct revoke action.
- OAuth is the recommended connection; personal tokens are an explicit fallback.
- `automations:read` is displayed as **Read daily brief** for compatibility.
- `automations:write` is not offered on new tokens. If an older token contains it, label it as a
  legacy inactive permission rather than implying authority.

Provider credentials remain in Ilo. Revoking an agent must not end human sessions or revoke a
different host.

## Workspace access in Settings

Settings → Workspace access answers **What may agents do here?**

The selected workspace is stored in the URL. Mail, Calendar, Tasks, and Finances each disclose:

1. Allowed actions.
2. Actions requiring signed-in approval.
3. Actions Ilo does not permit.
4. Whether access covers all connected sources or a provider-selected subset.
5. Connected-host authority and domain readiness.
6. The current server-owned setup step and optional setup reference.

Do not imply per-source credential scope when the credential model is workspace-wide. State that
limitation explicitly. Readiness is evidence, not a progress percentage. Use the stable phases
Checking, Not set up, Needs review, Set up, and Unavailable.

Mail owns proposed and active Mail rules. Proposed rules remain disabled until a signed-in person
reviews the current bounded sample. Permanent deletion remains unavailable.

## Visual standard

These pages are flat and quiet. Separate related regions with spacing and contrasting surface
colors. Do not use gradients or shadows. Use borders only for controls or boundaries that would be
ambiguous without them. At most one primary raised region should compete for attention.

## Legacy routes

`/settings?section=agents` and `/settings?section=automations` redirect to Workspace access while
preserving relevant workspace and rule parameters. `/automations` also redirects there. There is
no generic routine-management UI or public routine API.
