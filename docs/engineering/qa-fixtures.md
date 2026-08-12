# QA fixture accounts

ilo keeps a deterministic set of local-only QA personas in the repository. The
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
| Polished demo | `demo+full@ilo.test` | `#%YxqD2Kz%8S#3` | Every workspace with polished calendar, task, mail, finance, goal, automation, activity, and preference data |
| Loaded workspace | `qa+loaded@ilo.test` | `Testing12345!` | A second broadly populated account for mutation-heavy QA |
| New onboarding | `qa+onboarding-new@ilo.test` | `Testing12345!` | Unverified, `not_started` account at the welcome step |
| Google onboarding | `qa+onboarding-google@ilo.test` | `Testing12345!` | Verified, `in_progress` account at Google setup with Calendar and Mail selected |
| Apple onboarding | `qa+onboarding-apple@ilo.test` | `Testing12345!` | Verified, `in_progress` account at Apple setup with Calendar and Mail selected |
| Finance onboarding | `qa+onboarding-finances@ilo.test` | `Testing12345!` | Verified, `in_progress` account at Finance setup with Tasks and Finances selected |
| Ready onboarding | `qa+onboarding-ready@ilo.test` | `Testing12345!` | Verified, `in_progress` account at the final Tasks-only summary |
| Empty workspace | `qa+empty@ilo.test` | `Testing12345!` | Completed setup with no material beyond the local calendar |
| Recovery states | `qa+recovery@ilo.test` | `Testing12345!` | Populated account with expired Google authorization and a finance account requiring reauthentication |

## Data contract

- IDs are stable UUIDs scoped to each persona.
- Calendar, task, and financial dates are regenerated relative to load time so
  Today, the current week, and the current month stay useful.
- Provider-backed records are projections with no real credentials. They are
  suitable for reading, empty/error/reconnect UI, and service behavior that does
  not call a provider.
- The demo and loaded-workspace accounts cover all-day, overlapping, tentative,
  focus, private, and future calendar events; overdue, inbox, scheduled, and
  completed work; unread, starred, snoozed, attachment, draft, and rule mail
  states; and cash, investment, debt, budget, review, recurring, alert, pending,
  and transfer finance states.
- Playwright loads this same catalog into its disposable PostgreSQL container
  and verifies the demo login across Calendar, Tasks, Mail, and Finances.

The canonical catalog and loader live in
`apps/api/src/qa-fixtures.ts`. Keep fixture additions deterministic, scoped to
the named users, and free of real provider credentials or personal data.
