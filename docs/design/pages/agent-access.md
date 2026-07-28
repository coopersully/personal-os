# Agent access — connection and guided setup specification

## User job

**Connect Ilo to the agent host I already use, then teach it how I want my
connected material handled without learning MCP or designing an automation
system myself.**

The surface is a handoff, not an embedded chat. Ilo publishes the authenticated
endpoint, the installable instruction pack, current readiness, and a
domain-specific starter prompt. Claude, Codex, and other compatible hosts run
the conversation and call the same scoped Ilo API.

## Information hierarchy

```text
Connection state
├── connected sources
├── authorized agent hosts
└── Mail profile and approved-rule state

Recommended handoff
├── 1. Add the remote MCP URL
├── 2. Install the Ilo guided-setup skill
└── 3. Choose a domain and copy its starter prompt

Access management
├── connected OAuth hosts and revoke actions
└── advanced local-token setup and revoked-token history
```

## Connection contract

- The API publishes a typed connection guide containing the configured MCP
  resource URL, skill source and version, install request, invocation, and
  support level for each domain. The web client does not hard-code deployment
  endpoints.
- Remote MCP with Ilo OAuth is the recommended path. The consent page names the
  requesting host, lists each requested permission in plain language, explains
  that provider credentials stay in Ilo, and provides authorize and cancel
  actions.
- Personal access tokens are an advanced fallback for local or manual hosts.
  Presets are task-oriented, permissions remain editable, and the secret is
  displayed once. Revoking one host never ends a human Ilo session or affects a
  different host.
- The setup skill stores durable preferences in Ilo domain profiles rather than
  host memory. It inspects the current profile before asking questions and
  requests only the shortest example-based interview needed to improve it.
- Domain selection changes the starter prompt and capability statement. The
  shared profile-and-attention workflow is available to Mail, Calendar,
  Reminders, Tasks, Finances, and Goals.
- Mail is the first full executable setup. It can inspect connected mail
  sources, learn account and label meanings, save a draft profile, preview
  exact recent candidates, and create disabled preview rules. A rule becomes an
  enabled `approved_rule` only after explicit acceptance.
- Finance adds a domain-owned readiness and reviewed-workflow surface in
  Finances → Profile. Richer shared handoff presentation remains outside this
  Settings-owned page.
- Other domains honestly state that they currently support profiles and
  attention items but not domain-owned executable rules.

## Readiness and recovery

- Missing Mail sources show a working route to Settings → Connections.
- A draft or active Mail profile and the count of enabled approved Mail rules
  are visible without opening the agent host.
- A failed connection-guide or readiness query renders one actionable error
  without hiding unaffected recovery actions.
- Copy actions are individually labelled and confirm their result through the
  shared transient-feedback system.
- Connected OAuth clients and access tokens show a compact permission count and
  last-use state. Revoked tokens remain in collapsed history.

## Responsive and accessibility contract

- The three recommended steps remain one ordered vertical sequence at every
  width. Readiness rows use columns only when their content fits.
- Every copy action, domain choice, permission preset, disclosure, and revoke
  action has a persistent accessible name and keyboard target.
- URLs and prompts remain selectable in read-only controls and wrap without
  widening the page.
- Capability and safety explanations use semantic alerts; iconography never
  carries the only meaning.
- The advanced token flow remains collapsed by default so OAuth and the short
  agent handoff retain visual priority.

## Verification

1. Complete account setup and choose **Connect an agent**.
2. Confirm the configured MCP URL and skill install request can be copied.
3. Connect a dynamic OAuth client, inspect the plain-language consent, complete
   PKCE exchange, and confirm the host appears in Settings.
4. Choose each domain and confirm the prompt and capability statement update.
5. With Mail connected, run `$ilo-setup`, save a draft profile, preview a rule,
   accept it, and confirm the active profile and approved-rule count update.
6. Revoke the OAuth host and confirm its tokens can no longer use MCP.
7. Create each local-token preset, confirm its scopes, copy the one-time secret,
   revoke it, and inspect revoked history.
8. Verify error recovery, keyboard operation, copy feedback, 320 px layout, and
   normal desktop layout.
