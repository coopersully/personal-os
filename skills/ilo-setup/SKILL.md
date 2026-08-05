---
name: ilo-setup
description: Configure a user's Ilo domain preferences, source meanings, categories, rules, and attention workflow through a short adaptive interview. Use when a user connects Ilo to an agent, asks to set up or refine mail/calendar/reminder/task/finance behavior, wants the agent to learn what signal and noise mean to them, or wants to preview and install an Ilo automation rule.
---

# Ilo guided setup reference

Create durable preferences in Ilo so they remain consistent across agent hosts. Do not store the
user's personal preferences in this skill or rely on conversation memory as their source of truth.

This skill is an optional compatibility reference. The authenticated `get_ilo_context` response
is the orientation contract, and `get_ilo_setup` is the authoritative setup plan, including the
current semantic step, completion evidence, required tools, and human approval boundary. A host
does not need to install this skill when it can call those tools.

## Run setup

1. Call `get_ilo_context`. Use its identity, local time, granted scopes, available tools,
   readiness, and first-party links; do not infer a broader surface from this reference.
2. Call `get_ilo_setup`, passing the requested domain when one is known.
3. Follow the returned `currentStepId` and that step's instructions and `requiredTools`. If the
   person or host requests context for a specific semantic step, pass its stable ID back as
   `stepId`; `selectedStepId` then identifies the requested view, but it does not advance the
   actual current step. Never infer completion from step order or conversation history.
4. Work only with the scopes reported by Ilo. Explain missing capability instead of requesting
   broader access automatically.
5. Read the selected domain reference only when it adds detail needed by the current plan. Inspect
   a small, representative material sample and read full sensitive content only when summaries
   cannot answer the setup question.
6. Ask the smallest useful set of questions after exhausting safe Ilo evidence. Prefer choices
   grounded in examples over abstract configuration, and ask one question at a time when the host
   supports conversation.
7. Save a `draft` profile first and use `expectedVersion` when revising it. Summarize the inferred
   objective, source meanings, categories, instructions, and exceptions.
8. Preview every executable rule against its documented bounded window before creating it. Recheck
   the saved rule immediately before activation.
9. Preserve the approval boundary returned by Ilo. State what will happen automatically, what will
   remain in review, and what will never happen.
10. Call `get_ilo_setup` again after saving, approval, or any capability change. Finish only when Ilo
   reports `complete`, or clearly explain the current blocked or human-owned action.

Never treat an installed skill, broad token, or confident inference as user approval. Ilo's API
policy, setup plan, profile approval, and rule state are authoritative. Use
`get_agent_setup_status` only as an explicitly enabled compatibility status view when the
orientation and setup-plan tools are absent.

## Use the shared object pattern

- A **domain profile** records durable preferences and source context.
- A **rule** records a domain-owned condition and action inside Ilo's common versioned envelope.
- An **attention item** records an important, upcoming, follow-up, or post-run summary item.
- An **audit event** is evidence of what actually happened.

Do not use attention items as general memory or duplicate full mail, calendar, task, or finance
records. Link to the source record when one exists.

## Route by domain

- For mail setup or cleanup rules, read [references/mail.md](references/mail.md).
- For Reminders setup, overdue review, or Reminder CRUD, read
  [references/reminders.md](references/reminders.md).
- For Finance setup and reviewed workflows, read
  [references/finance.md](references/finance.md).
- For Calendar setup or evidence-based event proposals, read
  [references/calendar.md](references/calendar.md).
- For task interviews, read
  [references/core-domains.md](references/core-domains.md).

Goals may inform prioritization when the user enables them, but they are not required for core
setup.

## Finish clearly

Return:

- The profile or rules saved and their versions.
- The exact sources covered.
- The previewed candidate count.
- Which behavior is active versus draft.
- Any open attention items or approvals.
- The Ilo action needed to pause, revise, or recover the setup.
