# Activity — reference page specification

## User job

**Find who or what changed my material, understand repeated changes as one
operation, and verify that ilo is not acting invisibly.**

Activity is a human-readable audit projection. It does not replace immutable
audit records or expose sensitive before/after payloads in the default view.

## Information hierarchy

```text
Orientation (app frame)
└── Search across actions, actors, and material types

Activity (sequence)
├── One row for an individual audit event
└── One disclosure for repeated events from the same request, actor, and action
    └── Individual audit events in source order
```

## Interaction contract

- Search belongs in the app frame and is reflected in the `q` query parameter,
  so the filtered view is linkable and survives navigation history.
- Search matches the action identifier and its human-readable label, actor
  label, and material type. It never searches redacted audit payloads.
- Events with the same request, actor type, and action are presented as one
  closed disclosure with a visible change count. Opening it reveals each event
  without inventing a different audit relationship.
- Actor labels remain plain language: **You**, **Agent**, **Connector**, and
  **System**. Icons supplement those labels and never carry identity alone.

## State matrix

| Situation | Visible treatment |
| --- | --- |
| Loading | Standard workspace skeleton. |
| Unavailable | Inline error with the API-provided failure detail. |
| No recorded events | “No activity yet” and a concise explanation of what will appear. |
| Search has no matches | “No matching activity” with guidance to try another action, actor, or material. |
| One event | Compact sequence row with action, actor, and relative time. |
| Repeated request | Closed disclosure with action, actor, count, and relative time. |

## Implementation map

| System concept | Current implementation |
| --- | --- |
| app-frame search | `ActivityTopbarControls` |
| activity query and states | `ActivityPage` |
| request grouping | `groupActivityEvents` |
| actor and action copy | feature-local formatting in `features/activity/page.tsx` |

## Verification

1. Render loading, unavailable, empty, populated, and no-search-result states.
2. Search by an actor label and confirm unrelated actors are removed; clear the
   query and confirm the full sequence returns.
3. Confirm repeated events from one request render one summary and retain all
   child events when opened.
4. Inspect desktop and narrow layouts. Confirm the frame search remains usable
   and the activity sequence has no horizontal overflow.
