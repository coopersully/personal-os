# Mail secondary navigation design

## Immediate job

Find the right conversation set, then act on an individual conversation without
mixing mailbox-wide controls into its reader.

## Diagnosis

- **Symptom:** Search and the single Unread filter occupy the app bar while
  sync and compose sit apart; other useful inbox scopes are absent from the
  primary scan.
- **Conditions:** Populated Mail at desktop and narrow workspace widths, with
  or without a selected conversation.
- **User cost:** A person has to infer which controls change the conversation
  list and which act on a selected conversation. Frequent triage destinations
  are not discoverable as a coherent set.
- **Root-cause layer:** Mail page composition. The shared app bar already has
  separate context and action slots; Mail is not using a compact mutually
  exclusive control family for list scope.

## Approved design

The Mail app-bar context becomes one labelled mailbox-navigation `radiogroup`. Search
remains first. A compact `ToggleGroup` selects **All mail**, **Unread**,
**Starred**, or **Snoozed**; it changes the URL-backed scope and clears the
selected thread. A selected scope uses Calendar's flat toggle treatment, so it
is clear this is one list view rather than independent filters.

Sync remains a mailbox-wide utility and Compose remains the primary mailbox
action in the app-bar action slot. Reply, archive, trash, snooze, star, and read
state remain in the reader because each requires an identified conversation.

## URL contract

- All mail has no scope parameter and preserves a text search.
- Unread uses `unread=1` and removes a conflicting `view` parameter.
- Starred and Snoozed use `view=starred` and `view=snoozed`, respectively, and
  clear `unread`.
- Any scope change clears `thread`; search also clears `thread` but preserves
  the active scope.

## Maturity and verification

This is a Mail-specific, established page rule. It follows the existing
Calendar app-bar composition and shared `ToggleGroup` choice contract; it does
not introduce a new global navigation primitive. Verify URL behavior with
Testing Library, populated desktop and 390 px Mail in the local fixture runtime,
keyboard operation, and the repository verification gate.
