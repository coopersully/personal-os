# Feedback and validation

This is ilo's toast-first feedback policy, informed by the sources below and a
source-code review on 2026-09-30. It defines the intended standard; the audit
records implementation gaps. The implementation notes below distinguish the original audit from the resulting shared behavior.

## Definitions and selection

**Sonner** is the React component library that renders **toasts**: compact,
nonmodal notifications about events. **Alert** is a persistent contextual
callout. **Field error** explains how to correct a specific input. **Alert
dialog** interrupts for a consequential decision. Visual severity (success,
info, warning, error) is independent of surface: an error does not automatically
need a banner or a modal. ARIA `alert` is an announcement role, not a visual
component selection rule.

Prefer Sonner whenever the message concerns a discrete action and missing it
will not hide a required correction, an unresolved condition, or essential
recovery. Do not add notifications to every interaction just to maximize toast
usage; a clearly changed control or visible result can be enough.

Apply these questions in order:

1. Must the user make a consequential choice before proceeding? Use a
   confirmation/AlertDialog with the object, consequence, and named actions.
2. Must the user correct input? Use a field error; use a form-level message for
   a rule that cannot be assigned to a field. Never use a toast alone.
3. Does a condition continue to affect availability, trust in data, or recovery?
   Keep its status and recovery beside the affected work. Use Alert when it
   needs callout weight, or a compact status when that is sufficient.
4. Is this the result of a discrete action with a safe, discoverable next step?
   Prefer Sonner. If the visible result is already sufficient, omit extra feedback.

| Class and trigger | Default surface | Example / recovery |
| --- | --- | --- |
| Success: the requested operation is confirmed complete | Sonner success when confirmation adds value | “Profile saved.” |
| Pending: a user action is still running | Pending button for local work; one loading toast for work continuing elsewhere | “Refreshing wallpaper…” becomes the result in the same toast |
| Field validation: missing, malformed, or out-of-range input | Persistent field error | “Enter an email address in the format name@example.com.” |
| Related-field validation: individually valid values violate a relationship | Error beside the relevant field/group | “End time must be after start time.” |
| Server validation: the server rejects correctable input | Map to field/group errors; form message if no field applies | “That email address is already in use.” |
| Recoverable action failure: save, refresh, copy, or delete fails with a known safe retry path | Sonner error; retain values, actual saved state, and the original action | “Couldn’t refresh the wallpaper. Try again.” |
| Unsaved or uncertain result: work remains unsaved, or the operation may have succeeded despite a timeout | Persistent unsaved/checking state and recovery; optional single toast to announce failure | “Couldn’t confirm the change. Check the event before retrying.” |
| Conflict: another change prevents safely applying this edit | Persistent form/section message with resolution | “This event changed. Reload it before saving.” Preserve the draft |
| Load failure: initial data cannot be displayed | Error state in the affected region, with Retry | “Couldn’t load your calendar.” Never show an empty-success state |
| Stale/background failure: refresh fails but previous data exists | Retain data with freshness/status; Alert if materially blocking | “Showing the last update. Reconnect Google Calendar.” Avoid polling toasts |
| Capability/access/authentication: permissions, verification, or connection blocks work | Persistent contextual Alert or sign-in state | “Confirm your email to connect accounts.” |
| Temporary service limit: a rate limit or outage blocks repeated attempts | Toast for an isolated failure; persistent status if blocking continues | State a retry time only when known; do not encourage immediate retry loops |
| Destructive decision: an irreversible operation needs explicit consent | AlertDialog or equivalent deliberate confirmation | “Delete this event everywhere?” followed by a named delete action |

Classify by what the user can do next, not solely by HTTP status or by whether
React Query calls it a query or mutation. For example, a failed mutation can
require field correction, reconnecting, conflict resolution, or a safe retry.

## Validation timing and recovery

- Show requirements before entry when they are not obvious. Do not mark an
  untouched or actively incomplete field invalid on first keystroke.
- Validate on submit, or on blur after meaningful entry where useful. After an
  error is shown, revalidate as the user corrects it and clear it when valid.
- Keep server validation authoritative. Preserve entered values and keep the
  form open on failure. Map known server field errors to the same field UI.
- On failed submission, focus the first invalid field in a short form. For a
  long form, multiple errors, or errors outside the viewport, show and focus a
  summary with links to the fields. This is ilo's adaptation; GOV.UK requires
  a summary for every validation error in its own system.
- Associate error text using `aria-describedby`, mark the input
  `aria-invalid`, and describe the correction in text rather than color alone.
- A disabled submit button must not be the only indication of invalid input.
  Explain what must change. Never make the user guess why saving is unavailable.

## Sonner behavior and message quality

- Use one mounted Toaster available to each application flow that emits toasts.
  The shared feedback layer owns positioning, durations, dismissal, and styling;
  features own the action-specific language and recovery.
- Start with 5 seconds for short success/info messages as a product default,
  not an accessibility guarantee. Errors/actions should remain until dismissed
  or resolved unless the same explanation and recovery are persistently
  available in context. A sticky toast alone does not replace an ongoing status.
- Provide accessible dismissal and keyboard access to actions. Verify pause
  behavior on hover/focus and ensure toast placement does not cover essential
  controls on mobile or inside modal flows.
- Update one toast through loading and result; deduplicate by operation. Avoid
  repeated background/polling failures and duplicate global/local notifications.
- Keep announcements polite for routine outcomes; reserve assertive alerts for
  urgency. Do not steal focus for a toast or announce the same failure twice
  through an inline live region and toast.
- Use success only after confirmed completion. “Sync started” is not “Synced.”
  A failed refresh after a successful write must not say the write failed.
- Name the affected action/object and give a useful next step. Avoid generic
  headings such as “Something needs attention,” raw exception text, stack traces,
  or claims such as “Nothing changed” without evidence.
- Offer Retry only when safe; offer Undo only when it really reverses the
  operation. Essential recovery must remain available after toast dismissal.
  Do not automatically retry an uncertain, non-idempotent write.

## Review rubric

A feedback change passes only when every applicable check passes:

1. **Classification:** the cause and next user action are identified, including
   whether the result is known, unsaved, stale, or uncertain.
2. **Placement:** action results prefer Sonner; corrections live beside inputs;
   continuing blockers remain visible at the smallest affected scope.
3. **Recovery:** the next step works, preserves work, and remains discoverable
   after dismissal. Successful recovery clears obsolete errors.
4. **Timing:** no premature validation, premature success, or repeated toasts
   for a single incident. Persistent messages track current state.
5. **Copy:** the message identifies the problem and correction/recovery without
   blaming the user or exposing implementation details.
6. **Accessibility:** keyboard access, focus, announcements, field associations,
   and readable text work; essential information is not lost to a timeout.

Verify representative success, retryable failure, field rejection, persistent
blocker, and recovery in Settings and Today. Include narrow layouts and an open
dialog; check keyboard and screen-reader behavior directly when implementing.

## Original implementation audit (before migration)

Source review only; no runtime or assistive-technology conformance is claimed.
References identify functions because line numbers move.

| Observation | Evidence | Assessment / follow-up |
| --- | --- | --- |
| Shared Sonner and several appropriate result toasts exist | `apps/web/src/components/ui/sonner.tsx`; `app.tsx` → `ProfileSettings`, wallpaper refresh | Good foundation: profile saved, confirmation email sent, wallpaper refreshed/failed |
| Ongoing conditions use contextual Alerts | `app.tsx` → email confirmation and macOS availability | Appropriate persistence; retain these when expanding toast use |
| Shared load-error copy is used for write failures | `components/async-state.tsx` → `InlineError`; `app.tsx` → `AutomationsPage` install/run/update errors and `moveEvent.isError` | “Couldn’t load this material” misidentifies the operation; classify and route recoverable action errors to Sonner |
| Settings mixes query and action errors in a generic persistent Alert | `app.tsx` → `SettingsError`, account connection actions, `ProfileSettings`, theme update | Split validation/blockers from recoverable action outcomes; avoid blanket conversion |
| Forms expose one generic mutation error at the footer | `app.tsx` → `FormActions` | No field mapping in this component; introduce classification and field-level errors for known validation failures |
| Location is marked invalid while an unmatched search is being typed | `app.tsx` → `HomeLocationField`, `fieldInvalid` / `aria-invalid` | Delay invalid presentation until blur/submit; associated description currently explains location purpose, not the correction |
| Error text is passed through without contextual classification | `apps/web/src/api.ts` → `errorMessage` | Map known failures to useful product copy; keep diagnostic detail separate |
| Shared Toaster uses library defaults for timing/dismissal | `components/ui/sonner.tsx`; `app.tsx` → Toaster mount | Establish and verify shared policy before expanding actionable/error toasts |

Prioritize accurate error classification/copy and location validation, then
migrate eligible action feedback to Sonner. Keep load failures, form corrections,
unsaved state, and connection blockers persistent.

## Research basis

- [Sonner documentation](https://sonner.emilkowal.ski/): toast library,
  root Toaster, success/error/action/promise variants.
- [NN/g: Hostile Patterns in Error Messages](https://www.nngroup.com/articles/hostile-error-messages/):
  avoid premature validation and vague or unhelpful error presentation.
- [GOV.UK: Error message](https://design-system.service.gov.uk/components/error-message/)
  and [Error summary](https://design-system.service.gov.uk/components/error-summary/):
  identify correctable input, place errors with answers, and provide focused,
  linked summaries. Its exact page-form rules are not universal requirements.
- [W3C: Status Messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html):
  expose status changes programmatically without unnecessarily moving focus;
  choose announcement urgency appropriately.

The decision tree, toast preference, duration default, and acceptance rubric are
ilo policy synthesized from these principles, not a claim of one universal UX
standard or proof of WCAG conformance.

## Implemented ownership

- `lib/feedback.ts` classifies API, validation, access, conflict, rate-limit, and
  uncertain outcomes without exposing raw exceptions.
- `lib/use-feedback-mutation.ts` owns per-operation notification deduplication
  and confirmed-write versus failed-refresh semantics.
- `components/feedback-form.tsx` owns field associations, native/custom/server
  validation, focus, summary links, and retained values. Explicit field mappings
  support remote paths that differ from input names.
- `components/mutation-feedback.tsx` owns persistent mutation status;
  `components/async-state.tsx` owns query errors, stale status, and retry.
- `components/confirm-action.tsx` owns consequential confirmation and focus
  return, including commands originating in menus.
- The root Sonner host covers authenticated and authentication flows, with
  five-second routine notifications and accessible dismissal. Action failures
  that have no persistent copy remain until dismissed; the installed Sonner
  pauses timing during interaction and when the document is hidden.

The migration covers Settings, Today, Calendar, Tasks, Reminders, Goals, Motives,
Automations, Mail, Finances, and authentication. Product interaction tests cover
validation, preserved drafts, load/retry, stale state, clipboard errors, and
confirmations; desktop/mobile acceptance checks cover field focus and toasts.
