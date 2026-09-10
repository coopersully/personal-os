# Agent texting operations

ilo uses Twilio Programmable Messaging with one shared toll-free sender, not
Twilio Conversations. A verified US or Canadian recipient belongs to one ilo
account at a time. Phone numbers are encrypted; fingerprints are only for
routing and uniqueness.

Twilio STOP/START state is authoritative. STOP immediately marks the account
opted out and only an inbound START restores it. Provider error 21610 also
marks the account opted out. Website verification records consent but cannot
clear a retained provider STOP event.

Inbound webhook bodies are capped before parsing. For each signed inbound
message, ilo fetches Twilio's provider creation time and orders consent events
by that time rather than webhook arrival time. A delayed START cannot override
a newer STOP, and STOP wins when provider times tie. Provider consent keywords
are stored as consent events only: they never appear in the agent-readable
conversation or advance its revision. Routing excludes disconnected
connections so a number that is later verified by another account cannot send
new inbound messages to its former owner.

Starting verification first stores a durable `starting` challenge and cancels
older open challenges. It then requests Twilio Verify and records `pending` on
success or `uncertain` when the external outcome cannot be known. Only the
newest pending challenge can be approved; uncertain challenges require a fresh
verification request rather than an automatic provider retry.

Monitor verification failures, signature rejects, delivery failures, 21610
blocks, and quota rejections. Never log message bodies, phone numbers, webhook
payloads, tokens, or encrypted phone data. Disabling `TEXTING_ENABLED` stops
setup and sends; retain provider credentials so STOP/START webhooks still sync.

Every outbound request first commits a queued message and advances the
conversation revision, then makes one provider call with a 15-second timeout.
A process loss after Twilio accepts the message can therefore leave a visible
queued record without a provider SID. Network and 5xx failures mark that record
`unknown`; definite provider 4xx rejection marks it `failed`. Treat both queued
without a SID and `unknown` as uncertain delivery: do not automatically retry,
and reconcile from Twilio or the recipient before sending the same content
again. Status webhooks may only move a message forward through its lifecycle;
terminal delivery states never regress when callbacks arrive out of order.

Conversation reads use stable timestamp-and-ID cursor ordering. Only a current,
uncursored read issues the short-lived receipt required to send. That receipt
binds the user, agent, connection, consent epoch, revision, and time zone. The
send transaction locks and revalidates the connection and receipt before it
creates a message, preventing two sends from consuming the same read. Every
displayed message includes its UTC timestamp and an explicit local UTC offset.

Local tests prove validation, persistence, signed-webhook handling, and
degraded provider behavior with mocks. They do not prove production Twilio
authority, sender registration, carrier reachability, callback routing, or
STOP/START behavior. Before enabling production, an authorized operator must
use a dedicated test recipient to verify the complete flow and record only
message/provider IDs, timestamps, and final states—never phone numbers or bodies.
