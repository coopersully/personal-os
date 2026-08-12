# Mail

## Immediate job

Read and act on one unified mailbox while retaining clear source-account and provider authority.

## Connection health

- Mail uses the shared connected-account health contract; it does not interpret provider errors.
- A Mail-enabled account in `reconnect` produces one warning that names the affected account and
  links directly to Settings → Connections.
- Automatic retry and ilo-owned service attention keep the last synchronized material available.
  They do not claim the password is wrong and do not display raw provider responses.
- Connector health refreshes every 30 seconds while Mail is visible. Provider synchronization is
  owned by the server's five-minute scheduler, not browser polling.

## Acceptance

- Mail uses the full workspace body: the conversation list and reader fill the
  available shell height like Calendar, rather than sitting in a capped card or
  narrow page column.
- Connected-account headers are disclosure categories, not mailbox selections:
  they stay visually flat while their indented child destinations carry the
  active state.
- Unified and account mailbox navigation remains usable with stale synchronized material.
- A reconnect warning is scoped only to Mail-enabled accounts.
- Manual sync gives transient toast feedback and refreshes durable health after success or failure.
- No provider response body, token-shaped value, socket message, or exception reaches the Mail UI.
