# Settings UI Standards

Settings is a control surface for a person’s persistent preferences, access, and connected capabilities. Keep each screen calm: show the decision that matters now, explain a constraint where it occurs, and keep rare tuning out of the initial scan.

## Feedback

| Situation | Pattern | Behavior |
| --- | --- | --- |
| A short-lived action result | Sonner toast | Confirm success or failure, then disappear. Do not leave a duplicate inline message. |
| A recoverable error that blocks the current form or data view | `Alert` with `variant="destructive"` | Keep it beside the affected work until the user can correct or retry it. Use `role="alert"`. |
| A persistent but non-urgent requirement or platform capability | `Alert` with `variant="info"` | Explain the next step in plain language. Use `role="status"`; do not label it “Something needs attention.” |
| A persistent warning that affects account safety or access | `Alert` with `variant="warning"` and `AlertAction` | Give the callout a warning tone and place its action in `AlertAction`, not as an unstructured child. |

An inline message needs a specific title and a next step. Never use a static alert merely to repeat an available platform or an unchanging state.

## Forms & choice sets

- Use `FieldGroup` and `Field` for forms; use `FieldSet`, `FieldLegend`, and `FieldDescription` for related choices.
- Give every logical group a visible label and keep peer groups separated with a consistent 16 px divider or gap.
- Use a consistent selection treatment within a decision: radio cards for choices that need explanatory copy, and `ToggleGroup` for compact 2–7 option choices.
- Use the same card treatment for appearance choices that carry equal weight. Do not mix a card selector with an unframed row selector without a clear complexity reason.
- Persist only on an explicit save when multiple fields form one decision. For a single immediate setting, update optimistically and keep any failure adjacent to the control.

## Disclosure & availability

- Keep the default view to the core setup, the primary action, and the preview or outcome.
- Put infrequent tuning, verbose scope checklists, and historical records in a labelled `Collapsible`.
- Do not render an action that cannot work on the current platform. Show an informational capability callout only when the user can still complete useful preparatory work.
- Do not render restricted navigation or settings to users without the corresponding capability. Redirect a deep link to a safe, available settings section.

## Security & agent access

- Start an access-token flow with a named preset and selected-scope count.
- Keep detailed scopes collapsed until the user chooses to refine them.
- Keep active credentials visible; collapse revoked credential history by default.
- Secrets that are shown once stay inline until dismissed, because a toast is too transient for copy-once material.

## Sources

These choices follow the W3C guidance to reserve alerts for important, non-interrupting status changes and to avoid automatically dismissing critical content, plus progressive disclosure guidance for hiding advanced controls until needed. See the [WAI-ARIA alert pattern](https://www.w3.org/WAI/ARIA/apg/patterns/alert/), [WCAG status messages](https://www.w3.org/WAI/WCAG21/Understanding/status-messages.html), [NN/g progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/), and [shadcn’s Alert and Sonner documentation](https://ui.shadcn.com/docs/components/radix/alert).
