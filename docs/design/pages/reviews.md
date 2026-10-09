# Reviews and workspace decisions

Reviews collect human decisions and actionable conditions, not a generic activity feed. The active
experience is one shared flow in `features/reviews/flow.tsx`, using `ResponsiveDialog`: a dialog on
desktop and a drawer on mobile. The underlying workspace or Settings page stays in place.

## Entry and retained layout

Exactly two product entry locations: the workspace's attention alert (SidebarFooter/SidebarMenu for
Mail, Tasks and Finances; beside the Calendar title), and the action at the top right of its workspace
Settings header. Use the shared hand icon and **N items need review**, with singular grammar. Pending
work uses semantic warning tones; confirmed zero is neutral; unavailable counts never display zero.

The previous `ReviewsPage` bento layout remains in code, with its search, filters and sorting, but is
not routed or advertised. `/<workspace>/decisions` and old Finance/Mail review links redirect into the
workspace flow. Old Mail `reviewRule` links open the corresponding item in Settings. Removed item links
must report unavailable instead of silently substituting a different decision. `/reviews` falls back
to Account; Today, account summary cards and Finance's Views menu no longer advertise review pages.

## Known generated-link gap

At the `fe983085` source checkpoint, the notification policy and delivery service still generate
`/settings?section=reviews`, and the assistant context advertises `/reviews` as its approvals
link. Both fall back to Account rather than opening the requested review. The workspace entry
locations above work, but generated notification/agent links are not a completed navigation
cutover. Single-workspace targets need supported scoped links with navigation coverage.
[Texting](../../product/texting-operations.md) also retains an accepted requirement for one
unified destination when a message spans workspaces. The current flow accepts only one
workspace, so that cross-workspace destination is not implemented. Migrating single-workspace
links alone cannot satisfy it; do not substitute one workspace for the complete requested set
or claim that the current UI fulfills this target. This documentation records the divergence
without selecting a new cross-workspace routing design.

Known producers and contracts that must be reconciled together include:

- `packages/domain/src/notification-policy.ts` and `apps/api/src/notification-service.ts`: SMS
  composition and delivery links.
- `apps/api/src/assistant-service.ts`: assistant context approval links.
- `apps/api/src/routes/texting-recovery.ts` and the literal `reviewHref` schema in
  `packages/domain/src/texting.ts`: Finance reply recovery links.
- `apps/mcp/src/app-links.ts`, attached by `apps/mcp/src/tool-surface.ts`: assistant and default
  MCP approval links.
- `apps/web/src/app.tsx`: legacy redirects and the single-workspace flow host.

Migration evidence must cover notification composition/delivery, assistant context, Texting schema
and recovery route tests, MCP app-link/tool-result tests, and authenticated browser navigation.
Tests that merely assert the old URL do not prove the destination opens the requested work.
This limitation does not change domain approval or recovery requirements.

## Session behavior

- Load all snapshot pages in server priority order. A session is scoped to one workspace.
- Show one card with the decision, explanation, evidence and domain-specific actions. Use short,
  reduced-motion-aware transitions and focus the new card's title when advancing.
- Keep completed, remaining and initial total counts visible. Later skips only for this pass; it
  neither writes a dismissal nor increases completed. Offer another pass over remaining items.
- After a successful action, reload authoritative work. Advance and count completion only when that
  item is absent and the workspace source read is complete. Clarification, blocked/failed outcomes,
  and refresh errors keep the card outstanding. Disable navigation while a mutation is pending.
- Close returns to the same page and preserves its other query parameters. A newly opened session
  loads fresh work. New work arriving during a session belongs to the next session.
- Partial source reads visibly qualify the total. An unavailable source cannot produce “caught up.”

## Domain actions and authority

`review-actions.tsx` composes domain-owned APIs and existing Finance controls. Attention uses its
current version; Mail answers retain question versions and do not generalize; rule activation must
show exact bounded candidates, account scope, timing, and preserve candidate IDs, rule version,
preview timestamp and fingerprint. Active profile and successful reads remain required. Finance
uses its existing evidence/revision/idempotency and server policy checks. Neither the shared flow
nor a swipe may invent a generic approval or bypass those checks.

Source repair and provider reconnection can require leaving the flow for the source's editor or
authorization. Offer that explicit operation and retain the item until the server verifies resolution;
never present a generic Done button as proof of repair. Maintenance blockers without an answerable
question remain outstanding and can be left for later.

## Verification

Cover complete versus partial reads, failed writes, stale revisions, missing targets, Later, progress,
reopen freshness, scope preservation, keyboard focus, and desktop/dialog versus mobile/drawer behavior.
Approval-specific tests retain all evidence bindings when presentation changes.

## Transaction card refinements

Finance transaction reviews omit generic visible titles and descriptions. The transaction preview, decision kind, reason, and searchable category form a two-column grid on desktop and one column on narrow screens. Preserve an accessible card heading for focus announcements. Shared modal/drawer headers and footers use the same page-background surface. Category completion only updates the draft; the explicit decision action still submits the version-checked change.

Review flows lead with progress and decision material, without a generic workspace-review heading or instructional introduction. Keep the accessible dialog name. Suppress wrapper titles/previews when a domain adapter already renders the question, rule, or transaction; retain meaningful attention-item questions and approval consequences. Finance uses `TransactionSummary` for merchant, date, direction, and amount, with an explicit category-labeling prompt. Do not infer currency when it is missing.

On mobile the responsive drawer spans the viewport, including widths between 640px and the desktop breakpoint. Review footer actions remain side by side: Later is a quiet ghost action, Check status is secondary, and Review remaining is the primary continuation. The close icon is the only explicit dismissal control; do not duplicate it with Done or Close in the footer.

## Review recovery and exact targets

Attention action reads filter by the exact owned item ID before applying the result limit. Mail
question cards use the signed-in, owner-scoped `GET /v1/mail/questions/:id` endpoint rather than
searching the bounded status overview. Check status refreshes the selected action's revision as well
as the session snapshot, so a version conflict can be recovered without reopening the flow.

Mail rule approval always displays the match condition and future actions, including retention timing,
even when the bounded preview has no candidates. Mail maintenance blockers retain their title,
explanation, and preview evidence when no question is available to answer.
