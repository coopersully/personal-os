# Public documentation and Twilio submission

Status: merged repository implementation; production publication and provider verification require evidence.
Last reviewed: October 12, 2026.

## Public contract

John Cooper Sullivan operates nohmi. The user-confirmed support and privacy contact is
`coopersully02@gmail.com`. Public documents are generated as complete HTML in `apps/web/public`:

The browser root `/` now presents the product landing page. Authentication has dedicated `/login`,
`/signup`, and `/forgot-password` routes. Authenticated visitors can still read the landing page;
normal login opens `/today`, while protected links return to their validated local destination.
Email verification/reset links remain compatible; empty token parameters are ignored. Password reset clears cached account and
workspace data after session revocation, including for a signed-in visitor. The PWA starts at `/today` and the native desktop
entry remains the application. Public page headers link home and to `/login`.

| Path | Purpose |
| --- | --- |
| `/about/` | Product identity, mission, workspaces, operator |
| `/docs/` | Getting started, connections, delegation, help |
| `/privacy/` | Collection, use, sharing, SMS consent, retention, rights requests |
| `/terms/` | Service agreement, acceptable use, agents, SMS, limitations |
| `/data-use/` | Plain-language data and agent-access explanation |
| `/sms/` | Program disclosures, exact consent copy, enrollment, STOP/START/HELP |
| `/support/` | Working contact and request instructions |

Use the **actual deployed APP_BASE_URL** plus these paths for submission; do not substitute an API
origin, localhost, or an unverified product domain. The documentation has no JavaScript or account
requirement. Edit reviewed content in `apps/web/content/public`; `public:generate` renders all seven
through the shared shadcn public layout before dev/build. Vite publishes compiled stylesheet links
for these documents; nginx serves directory indexes before the app
fallback. Extensionless public URLs redirect to a relative trailing-slash path, preserving the
visitor's HTTPS origin behind the gateway rather than exposing the container's HTTP port.
`deploy/mac-mini/public-nginx.test.mjs` exercises all seven redirects and directory indexes using
the production nginx image and configuration. The PWA navigation fallback excludes these paths. Full document links intentionally use
anchors, not client-side routing. The sign-in footer and SMS enrollment link to the same documents.

The root product page is also rendered from `ProductLanding` during `public:generate`. Vite
embeds that shared markup in the root HTML before loading the client app, so the product page and
its policy links remain readable without JavaScript. The generated fragment is ignored; edit the
React component rather than maintaining a second copy of the landing text. Browser acceptance
covers the root and all seven documents with JavaScript disabled on desktop and mobile.

The product mission follows `docs/product/master-design.md`; public copy must distinguish intent
from deployed capability. Do not promise universal autonomous execution, immediate erasure, a fixed
retention deadline, certifications, or every external AI provider's training practices without
verified support. Privacy/terms now establish an adult service, no data sales or third-party
advertising, and non-transferable SMS consent. Changes to those commitments require policy review.
The operator should review jurisdiction-specific legal requirements before treating these general
terms as a complete legal program; no jurisdiction, arbitration scheme, or legal entity was invented.

## Actual Twilio integration

- `packages/connectors/src/twilio.ts` is the only Twilio SDK boundary: Verify SMS challenge/check,
  Programmable Messaging submission, message timestamp lookup, and signed webhook validation.
- `apps/api/src/texting-service.ts` owns enrollment, consent history, guarded agent sends, inbound
  messages, delivery updates, disconnect, provider STOP/START, and provider error 21610 handling.
- `apps/api/src/routes/texting.ts` exposes authenticated account flows and signed, payload-bounded
  inbound/status webhooks. Workspace services and MCP tools use this boundary, not Twilio directly.
- `apps/web/src/features/texting/page.tsx` has the unchecked, optional enrollment checkbox in Agent
  Texting and profile number enrollment. It sends a Verify code only after consent, then activates
  the connection after verification. `packages/domain/src/texting.ts` versions the consent text;
  October 7 disclosures use `2026-10-07-v2`. Enrollment submits that explicit version;
  stale or missing versions are rejected before writing a challenge or contacting Twilio. This
  makes a cached older app refresh and show current consent instead of recording a newer version
  that the visitor never saw. Existing consent rows are not rewritten or treated as
  having accepted this new version. Enrollment fields and cancellation stay disabled while a
  verification request is pending, so a late result cannot reopen a canceled number change. Verification completion copies the challenge's recorded
  version, so a deployment between the two steps cannot relabel an older acceptance. Completion
  atomically claims a still-pending, unexpired challenge in the connection transaction, so a late
  provider approval cannot activate a cancelled challenge or replace accepted consent. Changing
  the number starts with an unchecked consent checkbox.
- First outbound agent/maintenance messages include STOP instructions. Existing body/segment
  limits are unchanged. HELP responses are a **Twilio Messaging Service configuration requirement**,
  not a newly implemented app response. STOP/START are mirrored locally; START is not enrollment.
- SMS bodies and consent/delivery records are stored. Disconnect does not delete history.
  Authorized agents can receive account-scoped SMS history. Published privacy disclosures cover
  Twilio/carrier processing and external agents without claiming end-to-end SMS encryption.

## Sender type and registration

The existing deployment contract specifies a **shared toll-free sender**. Use Toll-Free Verification
for that number. A US local ten-digit sender would instead require the appropriate A2P 10DLC brand
and campaign registration. Check the live number type and registration before choosing a form;
policy pages alone do not establish approved messaging capability. Twilio Verify is a separate
verification service; do not describe its code traffic as proof of a registered conversational sender.

Suggested description (reconcile with enabled production workflows and selected use case):

> nohmi is a personal organization application operated by John Cooper Sullivan. Registered users
> optionally enroll their own mobile number in authenticated settings and verify it by SMS.
> Authorized agents send conversational messages, reminders, workspace updates, and questions
> about the user's tasks, calendar, mail, and finances. This is account-related, non-marketing
> traffic. No purchased lists or third-party advertising are used. Frequency varies with user
> activity. Users can reply STOP to unsubscribe or HELP for help.

Suggested message flow:

> Users sign in, open Settings → Texting (or the profile phone-number controls), enter their
> own US or Canadian number, and select an unchecked consent checkbox. The disclosure identifies
> nohmi, message types, variable frequency, possible message/data charges, STOP and HELP, optional
> consent, and Privacy Policy/Terms/SMS links. Users request a verification code and enter it to
> connect the number. Account creation does not require SMS enrollment. The public SMS page
> explains this flow; the authenticated screen is the actual opt-in mechanism.

Use `/privacy/` for PrivacyPolicyUrl and `/terms/` for TermsAndConditionsUrl; include `/sms/` for
program details and `/` for the product website (`/about/` expands on its mission). Supply the full HTTPS URLs. Confirm all
required registration details (legal name, business type, address, country, website, registration
identifier if required, contact, volume, number ownership) using the operator's real information.
Do not infer business identifiers or make up message volumes.

Illustrative samples for comparison with actual enabled templates, not evidence of sent messages:

- `nohmi: Your task review is ready. Open nohmi to review it. Reply STOP to unsubscribe.`
- `nohmi: Is yesterday's dinner reimbursable? Reply yes, no, or unsure.`

Use a question/reply sample only if that workflow is enabled and verified for the submitted sender.
Include any actual first-party link format and indicate embedded links accurately in the form.
Use anonymized samples, never real financial records or private message contents.

## Required evidence before submission or enabling production messaging

1. Deploy this build and fetch every public URL in a signed-out browser and with JavaScript disabled.
   Verify HTTPS, response content, links, and unrestricted access through the actual public edge.
   Test an installed PWA after the new service worker activates as well as a fresh browser.
2. Capture the **actual deployed enrollment screens**, including profile enrollment, unchecked
   consent, all disclosures and policy links, and the verification step. Make redacted screenshots
   publicly accessible and supply their exact URLs for the authenticated opt-in flow. The narrative
   `/sms/` page is not a replacement for that evidence. Do not publish account details or codes.
3. Configure the Messaging Service's Advanced Opt-Out and HELP response to identify nohmi and give
   `coopersully02@gmail.com` as the support contact. Suggested HELP text:
   `nohmi: For help email coopersully02@gmail.com. Message frequency varies. Message and data rates
   may apply. Reply STOP to unsubscribe.` Review opt-in confirmations for the program name,
   frequency, rates, and STOP/HELP. The app currently adds STOP to the first program message but
   does not send a dedicated enrollment-confirmation SMS. If the submitted recurring program
   requires a welcome/confirmation message, implement it through the durable Texting send path
   or verify an approved provider-managed equivalent before submission; a Verify code is not a
   program welcome message. Toll-free carrier STOP/START behavior can override customizable
   responses; test what actually arrives. Verify the Verify Service friendly name identifies nohmi.
4. With an explicitly consenting test number, prove verification, an authorized message, its signed
   delivery callback, HELP, STOP suppression, START restoration, and disconnect behavior. Verify
   country permissions for the actual supported regions. Do not send test messages without consent.
5. Confirm the registered use case, samples, actual templates, public policies, and opt-in evidence
   match. Submit only after the operator identity and live sender configuration are verified. Record
   the provider result; do not label an unsubmitted or pending campaign approved.

Current gaps: no live account/number inspection, public deployment evidence, opt-in screenshots,
HELP/confirmation behavior evidence, real-phone smoke, or provider approval was established
by this documentation change. Green local tests cannot prove any of those provider/production facts.
The operator owns final legal review, provider configuration, submission, and the consented smoke.

## Sources

Requirements were checked against Twilio's official documentation on October 7, 2026:

- [Toll-Free Verification onboarding](https://help.twilio.com/articles/13264118705051-Required-Information-for-Toll-Free-Verification)
- [Toll-free verification API](https://www.twilio.com/docs/messaging/api/tollfree-verification-resource)
- [SMS consent sharing rejection](https://www.twilio.com/docs/api/errors/30521)
- [A2P 10DLC required information](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/collect-business-info)
- [Messaging policy](https://www.twilio.com/en-us/legal/messaging-policy)
- [Advanced Opt-Out and toll-free behavior](https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out)

Recheck current requirements before submitting; acceptance depends on the full application and
review, not just these pages.

## Verification evidence

### Final merged source

[PR #237 — Add public product and policy pages](https://github.com/coopersully/personal-os/pull/237)
merged on October 11 at `933e5b8cf52abc908711e5910f8c3b161b975f52`. Its final source head
`b4511c839de50a8baadfa79602a865947ed357c7` has successful repository-contract, lint,
Node-quality, browser-acceptance, macOS/Windows desktop, Terraform, and required CI checks.
These final hosted results supersede the incomplete branch-verification status in the dated
attempts below. They do not turn those earlier attempts into passes or establish production
publication, installed-PWA acceptance, live messaging behavior, or provider approval.

### Historical branch attempts

During the initial October 7, 2026 documentation pass, the 25 focused Texting UI/domain/database tests passed, as did all 18 public
documentation browser checks across desktop and mobile. Sign-in checks were repeated successfully
for visual inspection. The web production build, web/API type checks, and E2E type check passed.
The seven built documents matched source and contained no scripts or broken public-document links.

`pnpm verify` passed its lint and type-check stages, then failed in the coverage test run: 332 of
333 test files passed (3,370 passing tests). The existing Tasks lifecycle/Trash/restore test timed out
finding its cancelled task; it passed when rerun by itself. Full coverage and the repository-wide
build/E2E stages are therefore not claimed as passing. The focused build and browser results above
are separate evidence, not a substitute for a green repository-wide gate.

The subsequent landing/authentication and shared-layout refinement passed 24 focused unit/UI tests
and all 24 desktop/mobile public-page browser checks. Browser coverage includes no-JavaScript
access, shared navigation and cards, footer contrast, direct sign-up/back/refresh, and authenticated
return paths. The web production build and type check passed. All seven production documents
reference an existing compiled stylesheet, contain no scripts, and include the shared system-dark
theme tokens. Desktop and mobile screenshots were inspected after the final spacing/contrast fixes.

The later October 7 repository-wide `pnpm verify` attempt passed lint/infrastructure checks and workspace
type checks, then reported timeout failures in unchanged Calendar/goals/Finance tests and Task
migration tests. Five of seven UI failures passed on focused rerun; the other two passed using
the repository's existing CI timeout (20 seconds versus the local five seconds). The broad run
was stopped after the additional migration timeouts. It did not complete coverage or the subsequent
repository-wide build/E2E stages and must not be reported as green. No timeout or coverage settings
were changed; the successful focused web build and 24 browser checks are separate evidence.
