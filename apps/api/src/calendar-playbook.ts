import type { CalendarFindingKind } from "@personal-os/domain";

/** Server-owned Calendar stewardship policy for the first assessment release. */
export const CALENDAR_PLAYBOOK = Object.freeze({
  allOutstanding: { futureDays: 90, pastDays: 30 },
  sourceFreshnessMinutes: 15,
  tentativeHoldAgeDays: 7,
  supportedFindingKinds: [
    "source_stale",
    "source_unavailable",
    "recurrence_unassessed",
    "event_overlap",
    "buffer_shortfall",
    "tentative_hold",
  ] satisfies CalendarFindingKind[],
  limitations: [
    "Recurring series are not expanded in this release; their source is incomplete and blocks settlement.",
    "Travel, protected time, meeting load, out-of-hours load, recovery, and volatility are not calculated in this release.",
    "Event prose and attendee material never create intent or authority.",
  ],
  research: [
    {
      key: "ical",
      publisher: "IETF",
      reviewedAt: "2026-08-15",
      url: "https://datatracker.ietf.org/doc/rfc5545/",
    },
    {
      key: "caldav",
      publisher: "IETF",
      reviewedAt: "2026-08-15",
      url: "https://datatracker.ietf.org/doc/rfc4791/",
    },
    {
      key: "scheduling",
      publisher: "IETF",
      reviewedAt: "2026-08-15",
      url: "https://www.rfc-editor.org/info/rfc6638",
    },
    {
      key: "civil-time",
      publisher: "IANA",
      reviewedAt: "2026-08-15",
      url: "https://www.iana.org/time-zones",
    },
    {
      key: "google-events",
      publisher: "Google",
      reviewedAt: "2026-08-15",
      url: "https://developers.google.com/workspace/calendar/api/v3/reference/events/update",
    },
    {
      key: "preferences",
      publisher: "Microsoft Research",
      reviewedAt: "2026-08-15",
      url: "https://www.microsoft.com/en-us/research/publication/rhythm-of-work-mixed-methods-characterization-of-information-workers-scheduling-preferences-and-practices/",
    },
    {
      key: "recovery",
      publisher: "NIOSH",
      reviewedAt: "2026-08-15",
      url: "https://www.cdc.gov/niosh/bulletin/2012/sleep-and-work.html",
    },
    {
      key: "long-hours",
      publisher: "WHO/ILO",
      reviewedAt: "2026-08-15",
      url: "https://www.who.int/news/item/17-05-2021-long-working-hours-increasing-deaths-from-heart-disease-and-stroke",
    },
  ],
  version: "1.0.0",
} as const);
