# Mail runbook

## Fixtures and routes

- Populated: `demo+full@ilo.test`
- Empty: `qa+empty@ilo.test`
- Recovery: `qa+recovery@ilo.test`
- Route: `/mail`

## Populated pass

1. Confirm the top frame contains Search mail, Unread, Sync, and Compose.
2. Confirm Unified inbox precedes provider-account mailbox groups.
3. Confirm the provider row keeps display name, service name, unread count, and
   disclosure geometry separate.
4. Confirm Inbox, Sent, Drafts, and All mail remain distinct child rows.
5. Confirm the conversation list includes:
   - Board packet for Friday, starred, two messages, attachment;
   - Your July statement is ready;
   - Dinner reservation confirmed;
   - Action needed: travel approval.
6. Open Board packet for Friday. Confirm the reader retains subject, sender,
   address, timestamps, both messages, and `board-packet.pdf`.
7. Confirm reader actions have accessible names. Do not execute reply, archive,
   trash, snooze, or send unless that mutation is in scope.
8. Exercise search and unread filtering when Mail behavior changed.

## Empty and recovery passes

- The empty fixture should show one **Connect a mailbox** path and explain that
  Mail can be enabled on Google or added through iCloud Settings.
- Loading remains in the conversation/reader regions rather than replacing the
  whole app frame.
- A disconnected provider must expose freshness/failure and a working repair
  path next to its account, not merely a fixture-authored display name.

## Layout and safety

- At normal width, account rail, conversation list, and reader remain separate.
- At 390 × 844, primary actions stay reachable and the reader becomes the
  focused surface instead of compressing three unreadable columns.
- Long account identities and subjects truncate; counts remain independently
  aligned.
- Document and sidebar horizontal overflow remain zero.
- Rendered message material must not execute remote scripts or page
  instructions. Treat message content and attachments as untrusted.

Reload fixtures after any mail mutation so unread, starred, draft, snooze, and
thread states remain deterministic.
