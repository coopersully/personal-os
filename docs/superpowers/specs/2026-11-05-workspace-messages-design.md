# Workspace Messages and verified setup

User-approved display choice: preserve the full original human message in each related workspace.
One canonical SMS record supplies global and workspace projections. No excerpts or rewritten history.
Agent tags both sides with zero or more of mail/tasks/calendar/finances; empty means general, while
unclassified records remain global only. Replies link to inbound message IDs. Follow-ups inherit
relevant context through agent classification, without granting workspace access. Distinct topics
receive distinct concise agent replies. The global view shows all messages once; workspace views
filter on the server before pagination and expose a link to full context. Existing Finance chat
and its approval workflow remain intact; SMS destinations are /{workspace}/messages.

The API returns current setup proof: chat unlocked only with active configuration/consent/grants
and a real authenticated agent reply to an inbound batch with provider-confirmed delivery, bound
to current routine, authorization connection and phone consent epoch. Saved settings alone, a host
session, system notice or queued SMS cannot unlock chat. Setup shows phone, routine and reply-test
steps; text from the verified phone exercises the existing path. Changing configuration requires
fresh proof. UI gating does not delete history or prevent the agent from reading context to reply.

nohmi sends a concise system-authored notice for definite host rejection, rate limit, uncertain
handoff, or no reply after five minutes. Distinguish failure from uncertainty. At most one notice
per run and one per owner per fifteen minutes; retain message+notice identity before submission.
Never retry an uncertain SMS. Recheck current phone consent and routine identity before notice
submission. A subsequent agent reply remains allowed. System notices do not claim work succeeded,
do not mark the run completed, and never count as verification. If transport itself fails, retain
honest delivery evidence. No live production sends or new paid model path are part of development.

Screens use existing typography, surfaces, controls, icons and Sonner action feedback. Global and
workspace views share chronological message components, clear sender identity, day dividers,
quiet workspace labels and context links. Setup gate remains visible on every entry point until
server proof. Demo preview data must be explicitly identified and never treated as live proof.
