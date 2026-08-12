# ilo MVP

## Product statement

ilo is a transparent coordination layer shared by people and agents. It
combines reminders, calendars, and mail in one directly manipulable interface, while also exposing
the same operations through the Model Context Protocol (MCP).

The product is an overlay on existing operating systems, not a replacement for
them. The first release is an installable responsive web application, a compact
desktop shell for macOS and Windows, an HTTP API, and an MCP server.

## Target user

The first user is a technically comfortable individual who uses one or more
calendar accounts and delegates routine planning work to agents. The design must
remain understandable without requiring knowledge of MCP, OAuth, or calendar
provider internals.

## Jobs to be done

1. See today's reminders, events, and immediate local conditions from one calm surface.
2. Create, edit, complete, reopen, and delete reminders.
3. Create, edit, and delete local or connected calendar events.
4. Connect multiple Google accounts and select which calendars appear.
5. Read and search connected Google and iCloud mailboxes in one place.
6. Connect one iCloud account to Mail, Calendar, or both with one revocable credential.
7. Let an authorized agent work with the same material without screen scraping.
8. Inspect who or what changed an item and what changed.
9. Install the product on mobile and use it as a compact desktop overlay.

## Product principles

- **Shared material.** Direct manipulation and agent tool calls operate on the
  same domain objects through the same service layer.
- **Glass, not a black box.** Mutations record actor, source, before state, after
  state, and time. The UI exposes this history without making it the default
  view.
- **Progressive disclosure.** The default view is a focused agenda. Account,
  provider, sync, recurrence, and audit details remain available on demand.
- **Provider fidelity.** The normalized model never discards the provider ID,
  version, raw payload, or ownership information needed to reconcile changes.
- **Least privilege.** Human sessions and agent tokens are separately scoped.
- **Reversible by design.** Product-owned records use soft deletion and preserve
  enough history to restore accidental changes.
- **Useful without a connector.** A local calendar and reminders work immediately.

## MVP scope

### Included

- Email/password accounts with revocable server-side sessions.
- Scoped personal access tokens for MCP clients.
- Reminder CRUD, complete/reopen, due dates, notes, and priority.
- Local calendar CRUD.
- Google Calendar OAuth, calendar discovery, event synchronization, and
  write-through event CRUD.
- Incremental Google OAuth for Gmail read access plus an explicit modify/send upgrade, mailbox
  discovery, conversation synchronization, provider-backed thread actions, and sending.
- iCloud IMAP Mail and CalDAV Calendar through one encrypted app-specific password,
  with each capability independently enabled.
- Unified mailbox, search, conversation list, plain-text reader, drafts/sending, and
  provider-supported thread actions.
- Versioned domain preference profiles, cross-domain attention items, source-aware multi-inbox Mail
  setup, bounded exact Mail-rule previews with drift-checked activation, durable Google Mail
  retention work with exact provider reconciliation, Finance readiness and proposal-first review
  workflows, and a server-owned setup plan for scoped MCP hosts.
- A deployment-aware Agent access handoff with remote MCP OAuth, readable
  consent, semantic setup steps, observed completion evidence, core-domain
  readiness, an optional immutable skill reference, revocation, and advanced
  personal-token fallback.
- Unified agenda and calendar views.
- Current conditions in Today, preferring transient device location after the
  browser grants permission and falling back to an account-saved place selected
  by city, ZIP, or region. Device coordinates are never persisted.
- Search and date-window filtering.
- Audit history for all mutations and soft-delete restoration for product-owned
  reminders and local events.
- Responsive PWA with offline application shell and explicit offline state.
- Tauri desktop shell with compact window and optional always-on-top mode.
- MCP over stdio and Streamable HTTP.
- OpenAPI documentation, health/readiness endpoints, structured logs, and sync
  diagnostics.
- Local Docker Compose and production container deployment.

### Explicitly deferred

- Microsoft Graph and additional mail/calendar providers.
- Permanent mail deletion, provider filter/label creation, spam classification, and unsubscribe
  automation.
- Native Apple and Windows widget extensions. The Tauri overlay and PWA are the
  initial cross-platform surfaces.
- Shared/team calendars, invitations, scheduling polls, and meeting negotiation.
- General-purpose memory, autonomous multi-agent orchestration, or generated apps.

## Source-of-truth rules

- ilo is authoritative for users, reminders, sessions, access tokens,
  local calendars, local events, preferences, and audit records.
- A connected provider is authoritative for its calendars, events, and mail.
- ilo stores a normalized projection of provider data and retains the
  remote identifiers, revision, and raw payload required for reconciliation.
- An account-saved weather location retains the selected place label and
  coordinates from a searchable place picker so it can be retrieved without a
  second ambiguous geocoding lookup. Per-device weather coordinates are
  request-scoped only, never stored, and are used only to retrieve current
  conditions and an ephemeral human-readable place when browser permission is
  available.
- All writes go through the domain service. Provider writes complete before the
  local projection is committed as synchronized.
- Webhook notifications are hints. Synchronization is idempotent and verifies
  provider state.

## Acceptance criteria

The MVP is complete only when all of the following are demonstrated:

1. A new user can register, sign in, sign out, and revoke other sessions.
2. The user can complete every reminder workflow from the UI and API.
3. The user can complete every local-calendar workflow from the UI and API.
4. A configured Google account can authorize, discover calendars, synchronize
   changes, and perform event CRUD without bypassing the domain service.
5. An MCP client can list and mutate reminders and events using a scoped token.
6. A connected Google or iCloud mailbox can synchronize and be searched/read from both the UI and
   a `mail:read` MCP token without exposing credentials; supported mutations require
   `mail:write`, important-email attention derives its source from an owned thread, and automatic
   Google Mail rules require a still-active compatible profile, explicit Google sources, a bounded
   review, and an enabled `approved_rule`. Archive and recoverable Trash cross a durable bounded
   handoff, revalidate authorization at execution time, and reconcile uncertain provider effects
   before replay; permanent deletion remains unavailable.
7. A person can authorize a remote agent from the deployed MCP endpoint with
   visible scoped consent. The host can call `get_ilo_setup`, perform the safe
   Mail setup work it assigns, return for signed-in approval, verify completion,
   and be revoked from Settings without requiring a separately installed skill.
8. A Finance-scoped agent can inspect guided-setup readiness, save only a
   guidance draft, and prepare read-scoped categorization proposals. A signed-in
   person activates guidance and applies ledger/review mutations; the agent
   cannot cross provider-administration, permanent-rule, or
   ambiguous-transfer boundaries.
9. The agenda shows local and connected events together without losing source
   identity.
10. The activity view identifies human, agent, connector, and system changes.
11. The PWA passes its installability checks and works on narrow mobile viewports.
12. The desktop shell builds on macOS and Windows CI runners and its pin mode is
   functional.
13. Fresh local setup succeeds from documented commands.
14. The production container starts, migrates safely, reports readiness, and can
   be deployed with documented environment variables.
15. Lint, formatting, type checking, unit, integration, end-to-end, migration,
   build, and repository checks all pass.
16. Enforced statement/function/line coverage is 95% and branch coverage is 94% for product
    source code. Generated files, declarative configuration, and process entry
    points may be excluded, but not domain or application logic.
