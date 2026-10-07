# Workspace search

Approved direction: October 3, 2026. Implemented on the workspace-layout branch; this document is not production shipping evidence.

## Contract

Every workspace exposes the same search control in its primary header. Search spans the workspace,
not the selected view, mailbox, list, or visible calendars. Deleted/trash content is excluded.
Completed, archived, and hidden-source matches retain explicit context. No provider fetch is started
by a keystroke; results describe available synced data. Search opens existing details, forms,
settings fields, or the responsive review flow; it never performs a mutation.

Both sizes use an icon trigger. Desktop opens an anchored search popover; mobile uses the shared responsive dialog. Results group
records, dates, settings, navigation, actions, and reviews. Record matching is server-side,
authenticated, bounded, and paginated. Settings definitions are shared with the settings UI; the command catalog owns workspace
navigation and action launchers. Query state is distinct from list filters and never silently changes the page underneath.

## Ownership

The domain package owns the search contract. The API owns authorized record search, with domain
source projections and deterministic ordering. PostgreSQL remains authoritative; indexes are
rebuildable. Web owns labels, command launchers, and presentation. Every result and destination is
owner-authorized independently. Search requests and responses must not log private query/content.
Responses use `no-store`. Record-search admission allows two requests per process and one per
user concurrently, with 120 requests per user per minute. Matching deduplicates terms and rejects
more than twelve distinct terms. SQL searches have a transaction-local two-second statement
deadline, including lock waits; capacity is released on success or failure.
Review projections use separate PostgreSQL 17 transactions per source with a two-second statement
timeout and a 2.5-second transaction timeout. Each search-only source read admits at most 200 rows
and fetches one extra row to detect overflow. Timeout or overflow marks that source unavailable;
healthy sibling sources remain searchable. Finance evidence scans first select transactions with noncanonical maintenance effects and
then inspect only their evidence and referenced runs. Unrelated transactions and runs do not consume
the row budget. Relevant evidence overflow fails closed rather than deriving review truth from
truncated history, and can report incomplete coverage while other Finance sources succeed. Ordinary Review-list
pagination still uses the complete source data. Integration checks cover SQL lock cancellation,
source overflow, preservation of full list counts, and current versus stale contextual evidence;
production-scale latency remains unverified.

Workspace preference tables are account-owned, one row per owner, with revisions and typed values.
Calendar view preferences move out of implicit UI defaults into these preferences. URL selections
remain transient overrides. Shared time zone and day hours stay on the account. Per-calendar colors,
visibility, mail rules, finance categories/profiles, connections, and reviewed automation policy
remain authoritative domain records; settings screens compose these rather than duplicating them.
New preference tables are additive and default reads preserve existing behavior.

## Implementation sequence

1. Shared domain search/settings schemas, additive database schema/migration, authorized APIs/client.
2. Domain record search adapters, owner isolation, previews, pagination, archive filter.
3. Shared settings/action result catalog and header search with keyboard/mobile behavior.
4. Workspace integration, preference controls, existing editor/deep-link integration.
5. Focused API/UI tests, migration verification, typecheck, browser QA, repository verification.

## Acceptance

Search works outside current view scope; hidden calendars and archived tasks are discoverable.
Settings hits focus their actual field. New actions open forms, reviews open existing flow.
No cross-owner results or unsafe command execution. Literal punctuation is safe. Rapid queries
cannot display stale responses. Large result sets remain bounded. All four headers fit narrow
screens without a second search-only navigation bar. Empty, failed, and partial data are explicit.

## Branch verification — October 3, 2026

- 69 focused API and UI tests pass, including migration application, owner isolation, revision
  conflicts, archived results, settings navigation, and mobile search containment.
- Desktop and mobile Playwright acceptance pass for all four workspaces and Calendar settings
  field navigation. Repository type checking, E2E type checking, and production builds pass.
- The broader Node suite reports 3,075 passing tests and four failures outside this feature:
  Finance reimbursement bounds, a Finance migration assertion, password-input icon styling,
  and a dialog material assertion. Full repository verification is therefore not green.
- Production-scale search latency has not been benchmarked. Search uses bounded owner-scoped
  queries; this change does not add a persistent full-text index or provider-side search.
