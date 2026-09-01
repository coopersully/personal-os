# Planning surfaces runbook

## Fixtures and routes

- Populated: `demo+full@ilo.test`
- Empty: `qa+empty@ilo.test`
- Recovery: `qa+recovery@ilo.test`
- Routes: `/today`, `/calendar`, `/tasks`, `/reminders`, `/goals`, `/motives`
- Contracts: `docs/design/pages/today.md`, `docs/design/pages/calendar.md`, and
  `docs/design/pages/commitments.md`

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

Verify the fixture across the Tasks workspace Views:

| Route | Expected material |
| --- | --- |
| `/tasks` | Compare renters insurance renewals |
| `/tasks?view=today` | Draft weekly product update |
| `/tasks?view=upcoming` | Review monthly subscriptions |
| `/tasks?view=scheduled` | Review monthly subscriptions |
| `/tasks?view=completed` | Book dentist appointment |
| `/tasks?view=cancelled` | Replace spare charging cable |
| `/tasks?view=trash` | Compare desk lamps |
| `/reminders` | Send launch review agenda and Call Mom |

Confirm Views, Lists, and Projects are separate sidebar groups. Inbox is the default `/tasks`
selection and never puts its generated ID in the URL. Select Personal, Work, and Shopping Lists and
confirm the URL uses `list`. Under Personal and Work, confirm the duplicate Project name
**Quarterly reset** resolves within the selected List. Select a Project and confirm the canonical
URL contains both `list` and `project` and survives refresh.

Create/edit a Task with independent deadline and reserved-time fields; there must be no Next or
status selector. Exercise complete/reopen, cancel/reopen, trash/restore, Task move detachment
preview, Project move affected-count preview, Project completion conflict choices, and List archive
conflict choices. Each row keeps title, useful organization/timing context, lifecycle, and named
actions. The empty fixture must show selection-specific capture guidance.

## Personal context

- `/goals` exposes active goal progress and its edit/remove path.
- `/motives` exposes the saved motive without making it public elsewhere.
- Mutations must remain private to the signed-in fixture and survive refresh.

Reload fixtures after completing, deleting, creating, or moving material.
