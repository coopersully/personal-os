# Settings visual audit — October 21, 2026

## Scope and evidence

Inspected the running worktree browser app at 127.0.0.1:58405, using the demo
account. Screenshots are saved in `/tmp/nohmi-settings-audit/`. This is local
visual evidence, not a production or native-build verification claim.

| Destination | Visual coverage / outcome |
| --- | --- |
| Profile | Identity and daily defaults; shared leading icon alignment was checked in the preceding pass. |
| Setup | Compact navigation and workspace choices, immediate persistence retained. |
| Connections | Provider identity, capability rows, service constraint, related navigation. |
| Connected Agents | Endpoint row and local-token disclosure. No credentials created. |
| Security & Access | Password/session and destination rows. No security changes made. |
| Workspace Access | Review-policy setting and workspace capability summary; policy moved to shared row card. |
| Signed-In Devices | Two populated device records; no sessions revoked. |
| Invitations | Account is not authorized; route redirects to Profile. Not visually verified. |
| Activity Log | Search, event rows, lower history. |
| Goals / Motives | Populated records at top and bottom, including long descriptions and inactive records. |
| Rituals | Morning and Evening settings, step list, History and Data filters and entries. |
| Calendar | Preferences, calendar/provider hierarchy, guidance, permission navigation, setup summary. |
| Tasks | Preferences, unchecked controls, lower guidance and setup summary. |
| Mail | Preferences, connected account, rules, guidance and setup. |
| Finances | Household, income, payroll, empty collections, reserves, guidance and setup. |
| Appearance | System/light/dark visual choices. |
| Texting | Disconnected phone row. Verified-phone state not available in this account. |
| Desktop App | Browser install/unavailable-installer state. |
| Notifications / Desktop Pet / Wallpaper | Native-only destinations redirect in browser. Source layout reviewed; actual native controls are not visually verified. |

## Corrections applied

- Workspace preference cards now use the zero-inset row layout for all four workspaces.
- Fixed compact select triggers sitting at the start of their reserved value column.
- Preserved checkbox/radio/switch dimensions instead of letting the generic row grid collapse them.
- Texting's Phone row no longer has card padding wrapped around its own row padding.
- Financial household, income, payroll, and reserves use edge-to-edge row dividers.
  Empty collection summaries use a compact row; absent scalar values display “Not set”.
- Removed multi-column layouts that squeezed full settings rows into tiny cells:
  ritual history filters and financial collection editors.
- Existing workspace guidance now opens through a compact row into a focused dialog.
  Its version checks, validation, rejected drafts, and explicit atomic save remain intact.
- Review policy uses the same subsection label and row-card anatomy.
- Existing rich record/preview layouts have not been silently reclassified as scalar preferences.

## Questions to work through together

These are proposals, not newly adopted standards.

1. **Record summaries:** Goals, Motives, devices, rules, and ritual steps still have
   secondary Items with metadata and sometimes long prose. Should their closed
   state be one title line plus one metadata line, with full details in a dialog?
   Recommendation: a compact record-summary variant with bounded description;
   retain essential state and actions. Decide editing/navigation behavior first.
2. **Readiness and setup:** Workspace pages repeat guidance, permissions, and a
   sizeable “Finish Setting Up” block. Should setup become a single status row
   opening diagnostics? Recommendation: one summary with the next useful action,
   and a dialog for checks; don't hide failures or required consent.
3. **Atomic configurations:** Workspace guidance and permission/token flows cannot
   safely behave like independent switches without reconsidering validation and
   version conflicts. Recommendation: simple preferences autosave; dependent
   fields use a focused dialog with one explicit save/confirm.
4. **Unknown versus none:** Financial collections distinguish “not recorded” from
   confirmed “none”. Recommendation: preserve that distinction, but use clearer
   action copy than a small “None” button. Never infer zero from missing data.
5. **Empty scalar values:** “Not set” is now visible for financial text/numbers.
   Dates still show their input-format hint and money retains its currency addon.
   Should all idle empty controls have one consistent “Not set” presentation?
6. **Scope and inheritance:** Notifications, agent permissions, and workspace
   overrides need source/effective-value information. Recommendation: a short
   secondary source label with the value; detailed override/reset behavior in a
   dialog. Agree how inherited, disabled, and unavailable states differ.
7. **Previewable choices:** Appearance benefits from visual theme previews.
   Recommendation: preserve a documented preview exception rather than forcing
   image choices into a 48px row. Decide when previews belong inline vs a dialog.
8. **Platform-only testing:** Native settings cannot be inspected on the browser
   route. Recommendation: a supported preview surface using the same components
   and explicit mock capability states, plus native smoke tests. Do not fake
   native permissions or claim a browser audit covers them.
9. **Activity versus settings records:** Activity Log is a read-only chronological
   list. Recommendation: keep a dedicated list pattern with shared alignment
   tokens instead of treating each event as a preference editor.

## Rubric additions adopted in this pass

- Audit populated, empty, unchecked, long-label, and multi-column states, not just
  the first scalar row. Inspect lower sections as well as the first viewport.
- A settings row may not be placed inside a multi-column field grid. Use stacked
  rows; use an explicit stacked-form layout for bounded multi-field editors.
- Verify both the value column alignment and the actual checkbox/switch bounds.
- Mark inaccessible/permission-gated/native-only pages as unverified, not passed.

## Verification

Web typecheck and 43 focused tests passed (guidance/version conflicts, workspace
preferences, shared settings controls, payroll, execution policy, and ritual
history). No account preferences, access grants, tokens, or saved records were
changed during the visual inspection. The scheduled morning ritual appeared
during a final Finance recheck; its completion/skip state was not changed.

### Compact record summaries — proposed next discussion

Use a distinct compact record row, not a scalar-setting row: title and essential
state on the first line, an optional one-line summary on the second. Keep dates,
progress, and status together; put long prose and editing in a detail dialog.
A chevron identifies that dialog; navigation retains an arrow. Hide secondary
commands in a menu, while actionable failure or safety-critical state stays
visible. Do not truncate the only distinguishing identity or a consequence.
Target two lines at ordinary desktop widths, allowing wrapping and zoom without
fixed-height clipping. This is a proposal awaiting the user's design discussion,
not an approved blanket migration of Goals, Motives, and other record lists.
