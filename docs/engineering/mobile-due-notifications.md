# Expo due notifications

Local implementation for COO-29 — Native Tasks and Reminders workflows. This is not an APNs
server-delivery implementation or a verified TestFlight release.

- **Capability/owner:** Expo iOS uses Apple's User Notifications through `expo-notifications`.
  The shared Tasks projection owns eligibility; the device schedules at `dueAt`, never reserved time.
  Open, writable, undeleted records with future due dates qualify. No overdue replay.
- **Authority/configuration:** explicit device opt-in in Tasks → Views → Task preferences, then the
  system alert/sound permission request. The opt-in is owner-scoped in device Keychain. No badge,
  critical alert, time-sensitive bypass or background-fetch entitlement. Native builds must include
  the notifications plugin; Expo Go permission is for Expo Go, not the production nohmi app.
- **Transport/time:** the existing authenticated HTTPS API supplies records with its 15-second request
  deadline. Reconciliation fetches bounded pages, stops at the nearest 50 eligible alerts, and checks
  a 45-second elapsed budget between requests. OS calls use the native notification center.
- **Commit/delivery:** OS scheduling acceptance is not proof of banner display. iOS Focus, Summary,
  permission changes and device state determine presentation. Alerts use generic private-content
  text and standard sound; foreground presentation is quiet in Notification Center.
- **Lifecycle:** stable owner/kind/id identifiers prevent duplicate scheduling. Due-date changes
  replace pending requests; completion, cancellation, deletion and unavailable containers remove them
  on reconciliation. Successful app mutations, foreground entry and a foreground minute timer refresh
  the schedule. A serial queue and owner checks prevent late reads scheduling for another session.
  Sign-out clears this feature's pending and presented alerts. Other features' requests are preserved.
- **Recovery/observation:** read/scheduling errors use Sonner; explicit refresh and a five-second test
  are available in preferences. Existing same-owner schedules survive a failed startup refresh.
  Taps validate the notification owner and destination, then open the API-backed editor after login.
- **Limits:** only the next 50 alerts are scheduled. The app must reopen to replenish them. Web edits
  and completions cannot cancel or add local alerts while the app remains closed. A disconnected device
  may therefore show stale generic alerts. Robust cross-device delivery requires a separately tracked
  server scheduler/outbox, device registration, APNs credentials, token invalidation and receipt handling.
- **Evidence:** focused planner tests cover exclusion, deduplication, capacity, rescheduling, cleanup
  and owner-scoped routing. TypeScript and iOS/web bundle exports pass. Simulator native permission, scheduling acceptance and actual test-alert
  delivery in Notification Center verified through Expo Go. Physical iPhone delivery, cold-launch routing and TestFlight
  cancellation/account-switch acceptance remain required release checks.
