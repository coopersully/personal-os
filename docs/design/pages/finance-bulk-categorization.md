# Bulk transaction categorization

The Transactions page lets a person apply an existing category to selected records on the
current server page, in table or card view. Selection checkboxes are separate from opening a
transaction. “Select this page” selects only displayed records; there is no implicit selection
of other pages or all filter matches. The selection limit is 100; the current page size is 50.
Changing filters, sort order, page, displayed IDs, or observed revisions clears selection.

Confirmation lists the selected records, their amounts and current categories, and the replacement
category. The existing authenticated categorization API receives those exact IDs and observed
transaction revisions. This operation does not create merchant rules. Existing single-record
categorization, context editing, and splits remain available.

One Sonner toast progresses from pending to the confirmed outcome and lists each selected record's
applied, failed, review-required, or unconfirmed result. Partial success never implies that the
entire batch succeeded. No optimistic category updates or automatic mutation retries occur.
Submission clears selection. The user must successfully reload transactions, inspect their current
state, and select records again before another batch; this also covers stale revisions and a lost
response after an uncertain write. Failed reload keeps batch controls unavailable. Existing
single-record correction remains accessible.

The flow uses shared Checkbox, NativeSelect, and ResponsiveDialog primitives. Mobile confirmation
uses the shared drawer and a scrollable record list. Action feedback stays in Sonner; field and
recovery controls remain beside the affected work.

This is one manual-workflow slice. It does not establish onboarding completion, automation mode,
or complete manual parity. Source behavior is covered by the bulk-categorization and transaction
page tests; live desktop/mobile QA and final repository verification remain release evidence.

## Legacy budget submission compatibility

The existing category-budget form also preserves action dispositions. A pending approval or
request for information keeps the entered values and updates its submission toast with an action
to the exact existing approval or question in Reviews. Only an applied action outcome or the
legacy confirmed budget response clears the form and announces a saved budget. Rejected requests
retain the draft and use Sonner without exposing raw server errors. This consumer behavior is
compatible with the existing typed client and does not grant budget activation authority.
