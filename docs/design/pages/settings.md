# Settings

The immediate job is to inspect or change a preference, account, or connection.
Use the shared [feedback rubric](../feedback.md) for every operation.

- Profile and invitation forms use FeedbackForm. Server validation maps to named
  inputs; related planning hours and location selection validate on submit/blur.
- Profile saves and confirmation-email results use Sonner. Required email
  verification and unavailable platform capabilities remain contextual Alerts.
- Keep unsaved drafts and one-time invitation/token values visible through failed
  refreshes. Never replace cached settings with an empty-success state.
- Wallpaper board URLs are drafts until confirmed saved; failure preserves the
  typed URL, field correction, and Save board action. Other direct preferences
  roll back to their saved value when an update fails.
- Disconnecting accounts or revoking access requires a named confirmation.
- Query failures expose Retry; background failures retain prior values with a
  stale warning. Each error has one announcement owner.

## Layout and navigation

Settings is an account utility with its title and global search in the sidebar
header, without workspace top navigation. Each section uses `SettingsPageLayout`
for a visible page heading, short purpose statement, and consistent gutters.
Activity keeps its record filter in the page body; settings search does not replace
feature-specific data filters.

Use an Apple-like hierarchy: familiar grouped preferences, clear labels, restrained
semantic surfaces, and progressive disclosure. Use `SettingsSection` (a shared
shadcn Card composition) for distinct decisions, not every individual field.

Use `SettingsBento` for a compact setup group beside a larger editor. It switches
from one column to 1:2 columns at 46rem of available content width, independently
of rail/sidebar state. Preserve DOM reading order and let groups grow with content.
Account and Rituals demonstrate this composition. Other sections share the page
frame and may retain a single-column form or domain-owned cards.

Forms retain shadcn Field/FieldGroup/FieldSet, visible labels, and existing save
semantics. Keep security actions in a named group. Layout changes must not reset
drafts or change persistence.

## Search

The search button sits inline with Settings in the sidebar header and remains
available with the sidebar collapsed. At narrow widths the same search appears
in the page heading, alongside the existing dock's section navigation. If both
rails are collapsed, reserve a separate header row for the workspace switcher.

Compose a shadcn Dialog and InputGroup with ordinary navigable links. Rank individual
field names before aliases and section context; retain section results for browsing.
`features/settings/settings-fields.ts` is the field catalog: every new preference
needs its public label, synonyms, and a control ID or exact visible label. Never
index private values. Filter results using the sidebar's permission/platform rules.

Field links use `/settings?section=…&field=…`. `SettingsFieldFocus` opens only
allowlisted tabs, disclosures, or existing editors, then scrolls and focuses the
control after asynchronous content mounts. It never changes a setting, sends a
verification code, or submits a form. Conditional controls may target their
prerequisite when unavailable. Dialog dismissal must not restore focus over the
destination. Section descriptions and terms remain in `settings-search.tsx`.

Focus the input on open. Tab reaches results, Enter follows links, Escape closes
and restores focus, and no results offers another query. Search text stays local to
the dialog; field links identify the destination without applying a data filter.
