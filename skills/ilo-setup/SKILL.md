---
name: ilo-setup
description: Configure a user's Ilo domain preferences, source meanings, categories, rules, and attention workflow through a short adaptive interview. Use when a user connects Ilo to an agent, asks to set up or refine mail/calendar/reminder/task/finance behavior, wants the agent to learn what signal and noise mean to them, or wants to preview and install an Ilo automation rule.
---

# Ilo guided setup

Create durable preferences in Ilo so they remain consistent across agent hosts. Do not store the
user's personal preferences in this skill or rely on conversation memory as their source of truth.

## Run setup

1. Call `get_agent_setup_status`.
2. Work only with domains that the current token can read. Explain a missing write capability
   instead of requesting broader access automatically.
3. Call `get_domain_profile` before interviewing the user. Refine an existing profile rather than
   starting over.
4. Load the selected domain reference, then inspect connected sources and a small, representative
   material sample. Read full sensitive content only when summaries cannot answer the setup
   question.
5. Ask the smallest useful set of questions. Prefer choices grounded in examples over abstract
   configuration. Ask one question at a time when the host supports conversation.
6. Summarize the inferred objective, source meanings, categories, instructions, and exceptions.
7. Save a `draft` profile first. Use `expectedVersion` when revising it.
8. Preview every executable rule against its documented bounded window before creating it. Recheck
   the saved rule immediately before activation.
9. State what will happen automatically, what will remain in review, and what will never happen.
10. Activate a profile only after the user explicitly accepts that summary. Mail rule activation is
    a signed-in Settings action; the agent re-reviews the rule and hands it back to the person.

Never treat an installed skill, broad token, or confident inference as user approval. Ilo's API
policy and rule state are authoritative.

## Use the shared object pattern

- A **domain profile** records durable preferences and source context.
- A **rule** records a domain-owned condition and action inside Ilo's common versioned envelope.
- An **attention item** records an important, upcoming, follow-up, or post-run summary item.
- An **audit event** is evidence of what actually happened.

Do not use attention items as general memory or duplicate full mail, calendar, task, or finance
records. Link to the source record when one exists.

## Route by domain

- For mail setup or cleanup rules, read [references/mail.md](references/mail.md).
- For Finance setup and reviewed workflows, read
  [references/finance.md](references/finance.md).
- For calendar or reminders/tasks interviews, read
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
