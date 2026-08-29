# Agent texting operations

ilo uses Twilio Programmable Messaging with one shared toll-free sender, not
Twilio Conversations. A verified US or Canadian recipient belongs to one ilo
account at a time. Phone numbers are encrypted; fingerprints are only for
routing and uniqueness.

Twilio STOP/START state is authoritative. STOP immediately marks the account
opted out and only an inbound START restores it. Provider error 21610 also
marks the account opted out. Website verification records consent but cannot
clear a retained provider STOP event.

Monitor verification failures, signature rejects, delivery failures, 21610
blocks, and quota rejections. Never log message bodies, phone numbers, webhook
payloads, tokens, or encrypted phone data. Disabling `TEXTING_ENABLED` stops
setup and sends; retain provider credentials so STOP/START webhooks still sync.

Every outbound request first commits a queued message and advances the
conversation revision, then makes one provider call with a 15-second timeout.
A process loss after Twilio accepts the message can therefore leave a visible
queued record without a provider SID. Treat that state as uncertain delivery:
do not automatically retry, and reconcile it from Twilio or the recipient
before sending the same content again. Provider rejection marks the durable
record failed; status webhooks settle accepted messages asynchronously.

Local tests prove validation, persistence, signed-webhook handling, and
degraded provider behavior with mocks. They do not prove production Twilio
authority, sender registration, carrier reachability, callback routing, or
STOP/START behavior. Before enabling production, an authorized operator must
use a dedicated test recipient to verify the complete flow and record only
message/provider IDs, timestamps, and final states—never phone numbers or bodies.
