# Honest MCP Previews

- Status: Approved design
- Date: 2026-08-28
- Scope: PR 1 of the Finance stewardship follow-up

## Problem

Ilo currently marks selected MCP tools as visual entrypoints and points all of them at one generic
`ui://ilo/work-surface` MCP App. The app presents a title, workflow metadata, and a scrollable JSON
dump. MCP hosts therefore open a large user-facing panel for results such as Ilo orientation even
though the panel does not explain the result or help the person act on it.

This is a truthfulness and hierarchy defect. Advertising a visual entrypoint promises a designed
view, not a developer inspector. It also makes ordinary tool use feel disruptive because the host,
not Ilo, decides when to expand an advertised MCP App.

## Outcome

Only tools with a purpose-built, tested presentation may advertise an MCP App. Ordinary context,
setup, and record reads stay in chat through their text and structured result. Curated Finance
results use compact presentations that explain the financial state, its evidence and uncertainty,
and the next useful action without exposing a raw JSON wall.

## Product rules

1. A tool without an explicit presentation kind never publishes `_meta.ui.resourceUri`.
2. Context, setup, ordinary reads, and uncurated previews do not open a visual.
3. A visual retains useful text and structured output for hosts that do not render MCP Apps.
4. The default view contains only human-facing material. Raw structured data may appear only
   behind a labelled disclosure.
5. The view states what is known, stale, estimated, excluded, or unresolved. It never converts
   missing data into a reassuring zero.
6. The MCP App does not calculate financial meaning. Domain/API contracts supply the presentation
   model; MCP selects and renders the declared view.
7. Invalid or unavailable presentation data renders a compact fallback directing the person back
   to the chat result. It never falls back to an unbounded JSON dump.
8. Visuals are read-only in this slice. Consequential actions continue through existing tools and
   policy boundaries.

## Initial presentation set

The first slice supports four Finance presentation kinds:

### Financial snapshot

Shows the as-of time, net worth, cash, debt, investments, source freshness, exclusions, unresolved
ownership or account-semantics gaps, and one appropriate next action. Values must retain the
Finance API's trust disclosures.

### Budget

Shows expected resources, allocations, the balance proof, explicit savings and investment funding,
material assumptions, approval state, and unresolved gaps. The renderer uses the current budget
contract; the separate budget-buckets PR will later extend this view without changing the MCP App
boundary.

### Review

Shows the exact decision or answer needed, the relevant evidence and source count, uncertainty,
financial impact when known, and the owning Ilo review link. It does not expose private question
payloads or imply that viewing the result approved it.

### Period verification

Shows the period and evidence cutoff, what was examined, what changed, what remains unresolved,
source freshness, and the recommendations already supplied by the Finance API. It distinguishes a
completed run from a maintained ledger.

## Contracts and ownership

`packages/domain` owns a small presentation schema shared by the API, MCP, and tests. It contains:

- a discriminated presentation kind;
- eyebrow, title, and concise summary;
- typed facts with labels, formatted or scalar values, and optional evidence state;
- disclosures grouped as important information or unresolved constraints;
- an optional first-party destination supplied as an Ilo route identity rather than arbitrary
  HTML; and
- bounded diagnostic facts for labelled detail disclosure.

Finance API result builders create the appropriate presentation alongside the existing domain
result. They reuse authoritative values and communication disclosures instead of recomputing
totals for display.

`apps/mcp/src/tool-catalog.ts` replaces the boolean visual flag with an explicit presentation
declaration. The declaration selects one registered `ui://` resource and must agree with the
presentation kind returned by the tool. `apps/mcp` remains a stateless adapter and renderer.

The MCP App resource is self-contained, uses host theme and size notifications, formats only the
bounded presentation model, and offers a labelled diagnostic-details disclosure when supplied. It does not
contain Finance calculations, workflow sequencing, or authorization rules.

## Discovery changes

Remove visual metadata from:

- `get_ilo_context`;
- `get_ilo_setup`;
- `get_daily_brief` until it receives a dedicated presentation;
- Calendar and Mail previews currently backed only by the generic work surface; and
- any Finance result that lacks one of the four initial presentation contracts.

Add visual metadata only to Finance tools that return the matching curated contract. Catalog
coverage tests fail when a visual tool lacks a known presentation resource or when an uncurated
tool advertises the generic work surface.

## Rendering and accessibility

The visual uses a compact open hierarchy rather than a nested dashboard:

- one orientation heading and as-of line;
- one primary summary region;
- a short fact list or allocation list;
- important disclosures before optional detail;
- at most one next-action link; and
- a closed diagnostic-details disclosure at the end when provided.

It must support narrow inline widths, light and dark host themes, 200% zoom, keyboard navigation,
visible native focus, reduced motion, long institution/category text, negative values, and missing
optional fields. Monetary signs and debt treatment come from the API contract and remain explicit.

## Failure behavior

- A missing presentation produces the normal chat result and no visual entrypoint.
- A malformed presentation received by an already-open resource shows: "This result is available
  in chat." It reports no financial values.
- An unsupported future presentation kind uses the same fallback so older deployed MCP Apps fail
  closed.
- Host initialization, theme, resize, or teardown messages remain bounded and contain no tokens or
  provider credentials.

## Testing

Focused coverage will prove:

1. discovery omits UI metadata for every uncurated tool;
2. each curated tool declares one known resource and returns the matching presentation kind;
3. text and structured fallbacks remain unchanged and useful;
4. each renderer handles complete, partial, stale, negative, long-text, and malformed fixtures;
5. raw data is closed by default and bounded;
6. keyboard, accessible names, dark mode, narrow width, and host resize behavior work; and
7. no renderer calculates or changes Finance totals.

Repository verification remains `pnpm verify`, including MCP contract tests, domain/API tests,
builds, and desktop/mobile browser acceptance.

## Non-goals

- Interactive approval or mutation inside an MCP App.
- A universal dashboard for every Ilo tool.
- New Finance calculations or advice.
- Budget bucket membership, Finance playbook behavior, or receipt lookup; those are subsequent
  approved PRs.
- A generic cross-workspace presentation platform beyond the minimum typed seams required by these
  four views.

## Rollout

The safe first deployment removes the misleading generic visual metadata and adds curated Finance
views in the same release. Older hosts continue to receive text and structured results. If a host
does not support MCP Apps, behavior is unchanged. Reverting the UI advertisement leaves API and
tool behavior intact because presentation metadata never grants authority.
