# Connect your AI subscription to nohmi Finance

**Draft onboarding copy for the planned experience. Not a statement that this setup
is available in nohmi today.** Exact controls and screenshots must be verified against
the released product before publication.

## What you are connecting

Your connected agent helps nohmi understand your finances and act on your requests.
Scheduled sessions handle regular financial maintenance. When you text, a focused
session handles your conversation without waiting for the next scheduled check.
nohmi keeps your conversation, preferences and financial records between sessions.

Claude is the first planned provider. Other agents will appear when their supported
subscription connections meet the same requirements.

## Before you start

- Have a supported Claude subscription with cloud routine and connector access.
  Confirm current eligibility during setup; organization policy can restrict access.
- Runs consume your subscription allowance. nohmi will not silently switch to a
  separately billed model API when that allowance is exhausted.
- SMS and nohmi service costs are separate from your AI subscription. The setup
  screen must show applicable charges; this guide does not promise a free service.
- Event responses depend on provider availability and session startup time. If
  processing is delayed, nohmi should show that your message is still pending.

## Setup walkthrough

### 1. Connect your account

Choose your agent provider in nohmi and follow the supported connection flow.
Authorize the nohmi connector in the provider's interface and confirm that the
correct nohmi account is connected. Never send login cookies or credentials in chat.

### 2. Choose what the agent may do

Select access to the relevant domains and actions. Separately choose whether
confident changes require review:

- **Review changes:** nohmi prepares changes for your approval.
- **Act autonomously:** nohmi performs authorized changes when it has sufficient
  information, verifies the result and keeps a record.

These are proposed descriptions, not verified current UI labels. In either mode,
nohmi asks when it does not know what you want. Autonomy does not grant access to
accounts or actions you have not enabled.

### 3. Set maintenance times

Choose one or two daily windows in your timezone. If you already have a Finance
routine, connect that routine instead of creating another one. nohmi should confirm
the next scheduled check and tell you if the existing routine cannot be adopted.

### 4. Enable conversation events

For Claude, the provider flow adds an API trigger to the same cloud routine.
[Scheduled tasks are in research preview](https://code.claude.com/docs/en/routines),
and the [fire API is experimental](https://platform.claude.com/docs/en/api/claude-code/routines-fire).
Request and response shapes, limits, token semantics and availability may change.
This trigger uses Claude Code subscription usage; it is not a Claude Platform
model API key.

Follow the provider's current enrollment instructions and transfer the scoped
routine credential only through nohmi's protected setup surface. Never paste it
into an SMS, support ticket or public document. The released guide must show exact
verified screens, credential rotation and revocation steps.

If event capability cannot be enabled, nohmi should clearly offer scheduled-only
operation. It must not label this as immediate conversational support.

### 5. Configure texts and updates

Verify your phone number and texting consent. Choose quiet hours and digest
preferences. Routine actions are summarized monthly by default. Material changes,
time-sensitive guidance and questions reach you separately when appropriate.

An unanswered question stays pending. nohmi must not treat silence as approval or
send repeated reminders without an applicable preference.

### 6. Check the connection

The guided check should distinguish:

| Check | What it establishes |
|---|---|
| Agent registered | nohmi recognizes the authorized host |
| Connector and Chat ready | The agent can access the required context |
| Schedule ready | The next maintenance run is configured |
| Event trigger verified | nohmi can invoke the connected host on demand |
| Texting ready | The authorized texting route is configured |
| Conversation verified | A real request was processed and its result returned |

A saved credential or successful session start does not prove all six checks.
Any test invocation/message must be clearly disclosed and user-initiated; it must
not mutate finances just to demonstrate connectivity. A real financial request
must follow the user's permissions and review mode.

### 7. Start with a real request

Ask a question about your finances or answer an existing categorization question.
nohmi should explain its result and whether any action was completed. If information
is missing, it should ask specifically instead of guessing.

## If something stops working

- **Subscription allowance exhausted:** work stays queued; no paid model fallback.
- **Permission or connection expired:** the app identifies the affected connection
  and the supported recovery step. Do not create duplicate bank accounts to repair it.
- **Text received but no completed response:** show pending execution separately
  from SMS receipt. Preserve the message for recovery.
- **Uncertain invocation or send:** reconcile the existing attempt before retrying;
  do not send the same financial request repeatedly to test it.
- **Financial data stale:** identify what is stale and qualify dependent guidance;
  independent safe work can continue.

## Change your mind or disconnect

Preferences, learned context and action history should be inspectable and
correctable. Changing a preference does not silently rewrite all past transactions.
Disconnecting stops future dispatch and revokes stored credentials. Already-started
provider sessions may require separate handling; show their actual state.

## Publication checklist for the existing owners

Verify all screens and labels on the released version; add screenshots without
secrets; link current provider eligibility and subscription documentation; show
actual service costs and usage limits; exercise existing-routine adoption and
partial-setup recovery; verify timezone handling, credential rotation and revocation;
measure response latency; verify a real conversation result. Do not publish the
draft as an available feature until these checks pass.

Provider references checked November 1, 2026:
- https://code.claude.com/docs/en/routines
- https://platform.claude.com/docs/en/api/claude-code/routines-fire
