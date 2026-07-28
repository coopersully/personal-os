# Reminders setup

Reminders are simple attention commitments. They are not scheduled Tasks, Calendar events, or a
notification-delivery system. `dueAt` is the instant Ilo uses for due and overdue views; it does not
prove that a platform notification will be delivered.

## Run the short interview

Read the existing Reminders profile, then inspect a bounded open sample with `list_reminders`.
Group the interview into at most five initial questions:

1. What are Reminders for, and should a capture default to anytime, use a stated due time, or ask?
2. What do low, medium, and high mean in the user's own words?
3. Does `dueAt` mean a deadline, a desired notification time, or something to clarify? Which
   notification lead time and time-zone behavior does the user expect?
4. When is an item overdue enough to review, which priorities enter review, and should Ilo keep the
   original time, review it, or propose a deferral?
5. Which bounded actions may an agent perform, and should the default policy be `read_only`,
   `preview`, `approve_each`, or `approved_rule`?

Ask a follow-up only when the answer changes a stored preference or action. Never infer urgency
from age alone.

## Save the profile

Use the shared profile fields for the objective, summary, instructions, and any user-defined
categories. Save these exact preference keys:

- `preferredAutomaticActions`: any of `create`, `update`, `complete`, `reopen`, `trash`, `restore`
- `defaultCapture`: `anytime`, `due_when_stated`, or `ask_for_due_time`
- `dueAtMeaning`: `deadline`, `notification_time`, or `ask_when_ambiguous`
- `notificationLeadMinutes`: the expected lead time or `none`; this records intent but does not
  install a notification
- `overdueBehavior`: `keep_due_date`, `review`, or `propose_deferral`
- `overdueReviewAfterDays`: whole days before review
- `priorityLowMeaning`, `priorityMediumMeaning`, `priorityHighMeaning`: the user's wording
- `preferredMutationPolicy`: the shared mutation-policy value the user wants the agent to follow
- `reviewPriorityAtOrAbove`: `low`, `medium`, `high`, or `none`
- `timezoneBehavior`: `profile_default`, `preserve_explicit`, or `ask_when_ambiguous`

Both `preferredAutomaticActions` and `preferredMutationPolicy` are durable guidance for the agent,
not access control. Saving or activating either value does not grant, revoke, or enforce mutation
authority. Token scopes and Ilo's API policy remain authoritative. Save a draft first and activate
it only after the user accepts the summary.

## Act safely

- Read a Reminder before updating, completing, reopening, or trashing it and pass its `updatedAt` as
  `expectedUpdatedAt`. `delete_reminder` returns the deleted revision required by
  `restore_reminder`. On a conflict, reload available state and ask again if the changed fields
  affect intent.
- Create, update, complete, reopen, trash, and restore only one identified Reminder per direct tool
  call. Trash is recoverable; do not describe it as permanent deletion.
- Before deferring multiple overdue Reminders, call `preview_overdue_reminder_deferral`. A
  successful preview is the exact candidate set and carries `preview` policy plus local source
  references. If the safety limit is exceeded, narrow the cutoff or priority.
- Show IDs, titles, current due times, proposed due time, and time zone. Apply an accepted set with
  guarded individual updates; stop and report any conflict instead of silently changing the set.
- Use a Reminders `follow_up` attention item when an ambiguous or conflicted item needs review.
  Include the Reminder's source and related entity ID. Resolve it when the review is complete.
- Tool annotations help clients present actions; they never replace API authorization, policy,
  audit, or recoverability.
