# QA fixture accounts

nohmi keeps a deterministic set of local-only QA personas in the repository. The
loader replaces only the accounts named below, so rerunning it refreshes relative
dates and restores a known state without deleting ordinary local users.

## Load or inspect fixtures

```bash
pnpm fixtures:list
pnpm fixtures:load
```

`fixtures:load` starts the repository PostgreSQL service when necessary, applies
pending migrations, and recreates every named fixture. It is safe to rerun.
Loading into a non-loopback database is refused unless
`QA_FIXTURES_ALLOW_REMOTE=true` is explicitly set for an intentional disposable
QA environment.

These credentials are test material, not secrets. Never reuse their passwords
for a real account.

| Scenario | Email | Password | Intended coverage |
| --- | --- | --- | --- |
| Polished demo | `demo+full@nohmi.test` | `#%YxqD2Kz%8S#3` | Every workspace with polished calendar, task, mail, finance, goal, review, activity, and preference data |
| Loaded workspace | `qa+loaded@nohmi.test` | `Testing12345!` | A second broadly populated account for mutation-heavy QA |
| New onboarding | `qa+onboarding-new@nohmi.test` | `Testing12345!` | Unverified, `not_started` account at the welcome step |
| Google onboarding | `qa+onboarding-google@nohmi.test` | `Testing12345!` | Verified, `in_progress` account at Google setup with Calendar and Mail selected |
| Apple onboarding | `qa+onboarding-apple@nohmi.test` | `Testing12345!` | Verified, `in_progress` account at Apple setup with Calendar and Mail selected |
| Finance onboarding | `qa+onboarding-finances@nohmi.test` | `Testing12345!` | Verified, `in_progress` account at Finance setup with Tasks and Finances selected |
| Ready onboarding | `qa+onboarding-ready@nohmi.test` | `Testing12345!` | Verified, `in_progress` account at the final Tasks-only summary |
| Empty workspace | `qa+empty@nohmi.test` | `Testing12345!` | Completed setup with no material beyond the local calendar |
| Recovery states | `qa+recovery@nohmi.test` | `Testing12345!` | Populated account with expired Google authorization and a finance account requiring reauthentication |

## Data contract

- IDs are stable UUIDs scoped to each persona except the protected Task Inbox. PostgreSQL creates
  each user's Inbox through the user trigger; the loader resolves that generated ID before
  assigning Inbox Tasks and never inserts or mutates Inbox directly.
- Calendar, task, and financial dates are regenerated relative to load time so
  Today, the current week, and the current month stay useful.
- Provider-backed records are projections with no real credentials. They are
  suitable for reading, empty/error/reconnect UI, and service behavior that does
  not call a provider.
- The demo and loaded-workspace accounts cover all-day, overlapping, tentative,
  focus, private, and future calendar events; the protected Task Inbox plus
  Personal, Work, and Shopping Lists; same-named Projects across different Lists;
  same-List Project moves; open, due, reserved, completed, cancelled, and trashed
  Tasks; unread, starred, snoozed, attachment, draft, and rule mail states; and
  cash, investment, debt, budget, review, recurring, alert, pending, and transfer
  finance states.
- Playwright loads this same catalog into its disposable PostgreSQL container
  and verifies the demo login across Calendar, Tasks, Mail, and Finances.

The canonical catalog and loader live in
`apps/api/src/qa-fixtures.ts`. Keep fixture additions deterministic, scoped to
the named users, and free of real provider credentials or personal data.

## Alex Morgan's planning story

The polished demo is Alex, a New York operations director at fictional Harbor Arts Center. Alex is opening
an affordable autumn workshop program while protecting time for a neighborhood 10K, friends, family, and a financial
buffer. A photography book is deliberately paused; an apartment reset and banking cleanup are wins
already completed. Motives explain the tradeoffs, including older beliefs Alex has retired.

`apps/api/src/qa-planning-story.ts` supplies this demo-only planning overlay: eight goals, seven
motives, seven projects across the existing Lists, 26 Tasks, and ten Reminders. It includes active,
paused, and completed goals; active/inactive motives; due, overdue, scheduled, unscheduled,
completed, cancelled, and trashed commitments. Work underway uses the real open Task lifecycle
with progress in notes; there is no invented in-progress enum. Dates roll with fixture load time
in America/New_York, and IDs remain stable. Existing calendar/mail/finance data and other personas
keep their existing fixture scenarios. A full fixture load restores the story.

## Candidate story personas (not loaded yet)

The populated demo is a life outside nohmi; product names belong in fixture infrastructure and
login domains, never in the person's employer, goals, or responsibilities. Keep technical
onboarding/empty/recovery accounts separate from these human stories.

- **Alex Morgan — steady community organizer.** Runs an arts center's autumn program, trains
  for a 10K, hosts friends, and builds a cash buffer. This is the currently loaded demo.
- **Sam Rivera — working parent with changing shifts.** Hospital work, school pickups, shared
  household responsibilities, a family trip, and saving for a reliable car. Cover tight days,
  rescheduling, short reminders, and genuinely competing commitments.
- **Priya Shah — independent ceramicist.** Client commissions, a seasonal market, workshop
  teaching, uneven income, invoices, tax reserves, and a creative project on pause. Cover
  project-heavy work, deadlines, correspondence, and money uncertainty.
- **June Park — returning student and caregiver.** Part-time study, a job change, supporting a
  parent, language practice, and moving home. Cover a light or interrupted schedule, long-term
  goals, gradually completed setup, and partial histories.

Before adding another persona, connect their story across goals and motives, task lists and
projects, reminders, calendar, mail, financial records, rituals and past responses. Reviews
should preview a concrete decision grounded in those records. Include completed and cancelled
work, quiet days, interruptions, realistic overdue items, and long or missing optional fields.
Use fictional people/providers and relative dates; do not equate more records with better coverage.

## Finance planning coverage

`demo+full@nohmi.test` has a reviewed manual Finance setup, individual account ownership,
a canonical financial profile, and an approved, balanced $8,250 monthly budget. It covers
housing, groceries, dining, subscriptions, travel, card repayment, emergency savings, a hiking trip,
long-term investing, and a $500 buffer. Wealth includes active, paused, and completed goals,
with explicit progress evidence. Cash flow includes confirmed payroll and bill schedules,
cash-balance statements with protected floors, and explicit transaction reflection evidence.

`qa+loaded@nohmi.test` has the same populated profile, goals and schedules, but an incomplete
budget with $500 still to allocate. Use it for incomplete-plan and approval recovery checks.
The empty, onboarding and connector-recovery personas keep their original missing setup,
unknown ownership and missing planning data. No real provider or automation is connected.
Reloading fixtures restores these states and refreshes dates in America/New_York.

Spending offers Bubbles, List, Trends and Rhythm through its View control. These views use
ledger transactions; planning fixtures do not manufacture posted spending or historical balances.

The full demo also has Essentials and Lifestyle budget buckets and a confirmed current-month
USD baseline scoped to checking, savings and the credit card. Spending can compare observed
monthly usage against approved category allocations. Transfer legs retain their incoming/outgoing
evidence. The loaded QA persona intentionally lacks this confirmation. Manual-source historical
coverage remains uncertified; that qualification is separate from the available budget comparison.

The full demo additionally seeds four completed calendar months of posted transactions relative
to the reload date: twice-monthly payroll, rent, weekly groceries, weekday coffee, weekend dining,
subscriptions, and variable travel (including one larger trip). Monthly amounts and weekday
activity vary deterministically for Trends and Rhythm. Current-month records and partial QA
personas are unchanged; current balances remain explicit statements, not a fabricated roll-forward.

## Settings collection state previews (development only)

For visual state audits without deleting fixture records or stopping services, append
`dataState=empty` or `dataState=error` to an existing local `/settings?page=…` URL.
The visible Development preview notice names the simulation and provides Exit preview,
which reloads the actual route without the parameter. Use a single audit tab and inspect
1100 × 844 and 390 × 844; scroll lower collections into view before capturing them.

`apps/web/src/features/settings/dev/data-state-preview.tsx` is a loopback-only, development
read adapter for an explicit list of collection endpoints (history, goals/motives,
activity, connections, calendars, sessions, invitations, agent credentials, and Mail
accounts/rules). The API composition root loads it only in browser development, never
in the desktop transport or production configuration. Authentication, configuration,
and permission gates remain real; an inaccessible admin route stays inaccessible.
It returns a successful empty read or a simulated 503, not an access-denial simulation.
The ritual current-state read retains the authoritative response/auth errors and hides
only its overlay in this isolated view; no completion, skip, or snooze is written.
Mail account previews retain other authoritative setup context.

Record mutations on the same origin return 409 while the mode is active, preventing
an absent-record preview from overwriting actual records. Auth flows remain real, and
other origins are never intercepted. Exiting preview clears the simulated query cache
through navigation/reload; re-enter normal mode before testing real mutations. These
previews prove presentation/recovery composition, not provider or production availability.
Use regression tests for actual retry/criteria retention, authority, and cached-data paths.
Preserve curated demo data during presentation-only audits; do not reload the catalog
solely to generate absence. The QA persona remains available for genuine empty-data tests.

### Local owner and native Settings acceptance

The worktree development Compose API defaults `OWNER_EMAILS` to the existing
`qa+loaded@nohmi.test` fixture when no explicit owner list is configured. This is
local QA configuration only; explicit owner configuration wins and production
configuration is unchanged. Use that fixture to exercise Invitations through its
real permission gate. Never promote the polished demo or bypass client/API checks.

For native UI acceptance, run the current worktree frontend through the actual
Tauri bridge in a separately identified QA application pointed at the local
runtime. An installed release with older assets is not evidence for local changes.
The app must launch from a valid macOS bundle with its declared sound resources;
launching the debug executable directly can crash UserNotifications. An unsigned QA
bundle cannot prove signed widget installation, login registration, or release delivery.
