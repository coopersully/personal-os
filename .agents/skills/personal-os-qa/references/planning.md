# Planning surfaces runbook

## Fixtures and routes

- Populated: `demo+full@ilo.test`
- Empty: `qa+empty@ilo.test`
- Recovery: `qa+recovery@ilo.test`
- Routes: `/today`, `/calendar`, `/tasks`, `/reminders`, `/goals`, `/motives`
- Contracts: `docs/design/pages/today.md` and
  `docs/design/pages/calendar.md`

## Today

With the populated fixture:

- The primary block says **Happening now** for Product strategy review and shows
  the supplied Google Meet action.
- Up next is not duplicated in Later today.
- All-day and later events remain ordered.
- The decision rail exposes overdue, no-due-date, due-today, and scheduled
  material with direct completion/edit/delete controls.
- Capacity text states the actual planning consequence.

With the empty fixture:

- The primary block says **The day is open**.
- Later today says nothing else is fixed.
- The commitments rail says **Nothing pulling at you**.
- Zero-state copy offers one useful capture path without dashboard filler.

Check normal and 390 × 844 layouts for scan order:
moment → day flow → decision queue.

## Calendar

1. Confirm local **My calendars** appears before provider groups.
2. Confirm the picker month/year label matches its visible grid and selected
   date. Treat a June label over a July grid as a defect.
3. Confirm week view shows all seven day headers, 24 hour labels, and horizontal
   rules aligned to the time axis.
4. Confirm Product strategy review, overlapping Design critique and Customer
   research debrief, the all-day Quarterly planning day, Focus block, Dinner
   with Maya, and the future Dentist appointment.
5. Confirm all-day text is not clipped by the compact header.
6. Confirm event and current-time layers remain above the hour grid.
7. Switch Day, Week, and Month using the labelled radio controls.
8. Confirm the document itself has no horizontal overflow; an intentional
   calendar canvas scroller is acceptable.
9. On the recovery fixture, provider error/freshness and a repair path must be
   visible beside the affected calendar group.

## Tasks and reminders

Verify the fixture across the dedicated task views:

| Route | Expected material |
| --- | --- |
| `/tasks` | Compare renters insurance renewals |
| `/tasks?view=next` | Draft weekly product update |
| `/tasks?view=scheduled` | Review monthly subscriptions |
| `/tasks?view=completed` | Book dentist appointment |
| `/reminders` | Send launch review agenda and Call Mom |

Each row keeps title, most-useful schedule fact, tags, state, and named actions.
The empty fixture must show a single capture-oriented empty state.

## Personal context

- `/goals` exposes active goal progress and its edit/remove path.
- `/motives` exposes the saved motive without making it public elsewhere.
- Mutations must remain private to the signed-in fixture and survive refresh.

Reload fixtures after completing, deleting, creating, or moving material.
