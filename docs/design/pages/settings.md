# Settings feedback

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
