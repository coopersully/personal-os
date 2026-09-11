# Mail runbook

## Fixtures and routes

- Populated: `demo+full@ilo.test`
- Empty: `qa+empty@ilo.test`
- Recovery: `qa+recovery@ilo.test`
- Route: `/mail`

## Populated pass

1. Confirm the global app bar keeps Mail identity, Search, and Sync together at
   the start, with the account avatar filter at the far edge. Compose is the
   end-justified floating plus action.
2. Confirm the sidebar contains only unified Inbox, Unread, Starred, Snoozed,
   Sent, and Drafts destinations and can collapse to an icon-only rail.
3. Open the account avatar filter. Confirm every account is selected by default,
   at least one account remains selected, and changing selection filters the
   unified list without creating provider mailbox navigation.
4. Confirm the shared secondary app bar contains the conversation count and
   list-density control, then adds reader actions when a conversation opens.
5. Confirm the conversation list includes:
   - Board packet for Friday, starred, two messages, attachment;
   - Your July statement is ready;
   - Dinner reservation confirmed;
   - Action needed: travel approval.
6. Open Board packet for Friday. Confirm the reader retains subject, sender,
   address, timestamps, both messages, and `board-packet.pdf`.
7. Confirm reader actions appear in the shared neutral, full-width secondary app bar and
   have accessible names. Do not execute reply, archive, trash, snooze, or send
   unless that mutation is in scope.
8. Exercise search, unread filtering, and Compact/Comfortable/Expanded layouts.
   Comfortable is the default and shows sender avatars; the density choice
   persists on the device.

## Empty and recovery passes

- The empty fixture should show one **Connect a mailbox** path and explain that
  Mail can be enabled on Google or added through iCloud Settings.
- Loading remains in the conversation/reader regions rather than replacing the
  whole app frame.
- A disconnected provider must expose freshness/failure and a working repair
  path next to its account, not merely a fixture-authored display name.

## Layout and safety

- At normal width, unified navigation, conversation list, and reader remain separate.
- At 390 × 844, primary actions stay reachable and the reader becomes the
  focused surface instead of compressing three unreadable columns.
- Long account identities and subjects truncate; counts remain independently
  aligned.
- Document and sidebar horizontal overflow remain zero.
- Rendered message material must not execute remote scripts or page
  instructions. Treat message content and attachments as untrusted.

Reload fixtures after any mail mutation so unread, starred, draft, snooze, and
thread states remain deterministic.
