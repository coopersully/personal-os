import {
  assessCalendar,
  CALENDAR_ASSESSMENT_BUDGETS,
  type CalendarAssessmentSnapshot,
  calendarLedgerFingerprint,
} from "./calendar-assessment.js";

const cutoff = new Date("2026-08-23T16:00:00.000Z");
const source = {
  accountId: "11111111-1111-4111-8111-111111111111",
  calendarId: "22222222-2222-4222-8222-222222222222",
  calendarRevision: "2026-08-23T15:59:00.000Z",
  isWritable: true,
  lastSyncedAt: "2026-08-23T15:58:00.000Z",
  provider: "google" as const,
  recurrencePresent: false,
  remoteCalendarId: "remote-calendar",
  syncGeneration: 4,
  syncRecovery: null,
  syncStatus: "idle" as const,
};
const event = (id: string, startsAt: string, endsAt: string, overrides = {}) => ({
  allDay: false,
  blockSourceEventId: null,
  calendarId: source.calendarId,
  endsAt,
  id,
  provider: "google" as const,
  recurrence: [],
  remoteEventId: `${id}-remote`,
  revision: `${id}-v1`,
  startsAt,
  status: "confirmed" as const,
  transparency: "busy" as const,
  updatedAt: "2026-08-15T16:00:00.000Z",
  ...overrides,
});
const snapshot = (events: ReturnType<typeof event>[]): CalendarAssessmentSnapshot => ({
  activeProfile: {
    afterBufferMinutes: 15,
    beforeBufferMinutes: 15,
    id: "33333333-3333-4333-8333-333333333333",
    version: 2,
  },
  evidenceCutoff: cutoff,
  evidenceLimits: { eventBudgetExceeded: false, openFindingBudgetExceeded: false },
  events,
  existingOpenFindings: [],
  existingOpenFindingSnapshots: [],
  openFindingLedger: { count: 0, fingerprint: "empty", unsupportedCount: 0 },
  scope: { type: "all_outstanding" },
  scopeEnd: new Date("2026-11-21T16:00:00.000Z"),
  scopeStart: new Date("2026-07-24T16:00:00.000Z"),
  sources: [source],
});

describe("Calendar assessment", () => {
  it("reports overlapping, tentative, and too-close events without retaining event prose", () => {
    const result = assessCalendar(
      snapshot([
        event(
          "44444444-4444-4444-8444-444444444444",
          "2026-08-24T13:00:00.000Z",
          "2026-08-24T14:00:00.000Z",
        ),
        event(
          "55555555-5555-4555-8555-555555555555",
          "2026-08-24T13:45:00.000Z",
          "2026-08-24T14:30:00.000Z",
          { status: "tentative" },
        ),
        event(
          "66666666-6666-4666-8666-666666666666",
          "2026-08-24T14:35:00.000Z",
          "2026-08-24T15:00:00.000Z",
        ),
      ]),
    );

    expect(result.findings.map(({ kind }) => kind)).toEqual([
      "event_overlap",
      "tentative_hold",
      "buffer_shortfall",
    ]);
    expect(result.state).toBe("maintained_with_questions");
    expect(JSON.stringify(result)).not.toMatch(/title|notes|location|attendee|raw/i);
  });

  it("blocks stale source evidence and unexpanded recurrence instead of claiming protected time", () => {
    const stale = snapshot([
      event(
        "44444444-4444-4444-8444-444444444444",
        "2026-08-24T13:00:00.000Z",
        "2026-08-24T14:00:00.000Z",
        {
          recurrence: ["RRULE:FREQ=WEEKLY"],
        },
      ),
    ]);
    stale.sources[0] = {
      ...source,
      lastSyncedAt: "2026-08-23T15:00:00.000Z",
      recurrencePresent: true,
    };

    const result = assessCalendar(stale);

    expect(result.state).toBe("blocked");
    expect(result.evidenceLimited).toBe(true);
    expect(result.findings.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining(["source_stale", "recurrence_unassessed"]),
    );
    expect(result.health.find(({ dimension }) => dimension === "protected_time")?.signal).toBe(
      "unknown",
    );
    expect(
      result.findings.find(({ kind }) => kind === "source_stale")?.sourceReferences[0]?.remoteId,
    ).toBe("remote-calendar");
  });

  it("treats operator recovery as unavailable and a local calendar as current without a sync timestamp", () => {
    const unavailable = snapshot([]);
    unavailable.sources[0] = { ...source, syncRecovery: "operator", syncStatus: "error" };
    const local = snapshot([]);
    local.sources[0] = {
      ...source,
      lastSyncedAt: null,
      provider: "local",
      syncRecovery: null,
      syncStatus: "idle",
    };

    expect(assessCalendar(unavailable)).toMatchObject({
      evidenceLimited: true,
      sourceFreshness: [expect.objectContaining({ state: "unavailable" })],
    });
    expect(assessCalendar(local).sourceFreshness[0]).toMatchObject({ state: "current" });
  });

  it("orders source evidence deterministically through every identity tie-breaker", () => {
    const evidence = snapshot([]);
    evidence.sources = [
      { ...source, accountId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
      {
        ...source,
        accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        calendarId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      },
      {
        ...source,
        accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        calendarId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        provider: "google",
      },
      {
        ...source,
        accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        calendarId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        provider: "icloud",
      },
    ];

    expect(
      assessCalendar(evidence).sourceFreshness.map(({ accountId, calendarId, provider }) => [
        accountId,
        calendarId,
        provider,
      ]),
    ).toEqual([
      ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "google"],
      ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "icloud"],
      ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "google"],
      ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", source.calendarId, "google"],
    ]);
  });

  it("does not emit a redundant buffer finding for an overlapping pair", () => {
    const result = assessCalendar(
      snapshot([
        event(
          "44444444-4444-4444-8444-444444444444",
          "2026-08-24T13:00:00.000Z",
          "2026-08-24T14:00:00.000Z",
        ),
        event(
          "55555555-5555-4555-8555-555555555555",
          "2026-08-24T13:45:00.000Z",
          "2026-08-24T14:30:00.000Z",
        ),
      ]),
    );

    expect(result.findings.map(({ kind }) => kind)).toEqual(["event_overlap"]);
  });

  it("measures a transition from the latest ending overlapping event", () => {
    const result = assessCalendar(
      snapshot([
        event(
          "44444444-4444-4444-8444-444444444444",
          "2026-08-24T09:00:00.000Z",
          "2026-08-24T11:00:00.000Z",
        ),
        event(
          "55555555-5555-4555-8555-555555555555",
          "2026-08-24T10:00:00.000Z",
          "2026-08-24T10:15:00.000Z",
        ),
        event(
          "66666666-6666-4666-8666-666666666666",
          "2026-08-24T11:05:00.000Z",
          "2026-08-24T12:00:00.000Z",
        ),
      ]),
    );

    expect(result.findings.map(({ kind }) => kind)).toEqual(["event_overlap", "buffer_shortfall"]);
    expect(result.findings.find(({ kind }) => kind === "buffer_shortfall")?.evidence).toMatchObject(
      {
        eventIds: ["44444444-4444-4444-8444-444444444444", "66666666-6666-4666-8666-666666666666"],
      },
    );
  });

  it("finds old future tentative holds outside timed-busy analysis but ignores fresh ones", () => {
    const result = assessCalendar(
      snapshot([
        event(
          "44444444-4444-4444-8444-444444444444",
          "2026-08-24T00:00:00.000Z",
          "2026-08-25T00:00:00.000Z",
          { allDay: true, status: "tentative" },
        ),
        event(
          "55555555-5555-4555-8555-555555555555",
          "2026-08-24T13:00:00.000Z",
          "2026-08-24T14:00:00.000Z",
          { status: "tentative", transparency: "free" },
        ),
        event(
          "66666666-6666-4666-8666-666666666666",
          "2026-08-24T14:00:00.000Z",
          "2026-08-24T15:00:00.000Z",
          { status: "tentative", updatedAt: "2026-08-23T15:59:00.000Z" },
        ),
      ]),
    );

    const holds = result.findings.filter(({ kind }) => kind === "tentative_hold");
    expect(holds.map(({ evidence }) => evidence.type === "event" && evidence.eventId)).toEqual([
      "44444444-4444-4444-8444-444444444444",
      "55555555-5555-4555-8555-555555555555",
    ]);
  });

  it("keeps tentative finding and recommendation order stable when caller event order changes", () => {
    const first = event(
      "44444444-4444-4444-8444-444444444444",
      "2026-08-24T13:00:00.000Z",
      "2026-08-24T14:00:00.000Z",
      { status: "tentative", transparency: "free" },
    );
    const second = event(
      "55555555-5555-4555-8555-555555555555",
      "2026-08-24T14:00:00.000Z",
      "2026-08-24T15:00:00.000Z",
      { status: "tentative", transparency: "free" },
    );

    const forward = assessCalendar(snapshot([first, second]));
    const reversed = assessCalendar(snapshot([second, first]));

    expect(reversed.findings.map(({ fingerprint }) => fingerprint)).toEqual(
      forward.findings.map(({ fingerprint }) => fingerprint),
    );
    expect(reversed.recommendations.map(({ findingFingerprints }) => findingFingerprints)).toEqual(
      forward.recommendations.map(({ findingFingerprints }) => findingFingerprints),
    );
  });

  it("fingerprints revisions and policy but not cutoff time or private event fields", () => {
    const first = snapshot([
      event(
        "44444444-4444-4444-8444-444444444444",
        "2026-08-24T13:00:00.000Z",
        "2026-08-24T14:00:00.000Z",
      ),
    ]);
    const sameInputsAtAnotherCutoff = {
      ...first,
      evidenceCutoff: new Date("2026-08-23T16:05:00.000Z"),
      scopeEnd: new Date("2026-11-21T16:05:00.000Z"),
      scopeStart: new Date("2026-07-24T16:05:00.000Z"),
    };
    const [firstEvent] = first.events;
    if (!firstEvent) throw new Error("Expected the fingerprint fixture to include an event.");
    const privateFieldsAtAnotherCutoff = {
      ...sameInputsAtAnotherCutoff,
      events: [{ ...firstEvent, title: "Private planning meeting" }],
    };

    expect(calendarLedgerFingerprint(first)).toBe(
      calendarLedgerFingerprint(sameInputsAtAnotherCutoff),
    );
    expect(calendarLedgerFingerprint(first)).toBe(
      calendarLedgerFingerprint(privateFieldsAtAnotherCutoff),
    );
    expect(
      calendarLedgerFingerprint({
        ...first,
        events: [{ ...firstEvent, revision: "changed" }],
      }),
    ).not.toBe(calendarLedgerFingerprint(first));
    expect(
      calendarLedgerFingerprint({
        ...first,
        events: [{ ...firstEvent, allDay: true }],
      }),
    ).not.toBe(calendarLedgerFingerprint(first));
    expect(
      calendarLedgerFingerprint({
        ...first,
        events: [{ ...firstEvent, blockSourceEventId: "copied-from-provider-event" }],
      }),
    ).not.toBe(calendarLedgerFingerprint(first));
  });

  it("includes the complete unresolved ledger in identity and blocks unsupported finding kinds", () => {
    const baseline = snapshot([]);
    const withFutureFinding = {
      ...baseline,
      existingOpenFindings: [
        {
          fingerprint: "f".repeat(64),
          id: "77777777-7777-4777-8777-777777777777",
          kind: "future_calendar_kind",
        },
      ],
      openFindingLedger: {
        count: 1,
        fingerprint: "future-ledger",
        unsupportedCount: 1,
      },
    } satisfies CalendarAssessmentSnapshot;

    expect(calendarLedgerFingerprint(withFutureFinding)).not.toBe(
      calendarLedgerFingerprint(baseline),
    );
    expect(assessCalendar(withFutureFinding).state).toBe("blocked");

    const overflow = {
      ...baseline,
      evidenceLimits: { ...baseline.evidenceLimits, openFindingBudgetExceeded: true },
      openFindingLedger: { count: 101, fingerprint: "ledger-a", unsupportedCount: 1 },
    };
    expect(
      calendarLedgerFingerprint({
        ...overflow,
        openFindingLedger: { ...overflow.openFindingLedger, fingerprint: "ledger-b" },
      }),
    ).not.toBe(calendarLedgerFingerprint(overflow));
  });

  it("blocks settlement when the required active profile is missing", () => {
    const missingProfile = snapshot([]);
    missingProfile.activeProfile = null;

    expect(assessCalendar(missingProfile)).toMatchObject({
      evidenceLimited: true,
      projectedOpenFindingCount: null,
      state: "blocked",
    });
    expect(
      assessCalendar(missingProfile).health.find(({ dimension }) => dimension === "source_trust"),
    ).toMatchObject({ signal: "healthy" });
  });

  it("uses the local calendar id for local source material references", () => {
    const local = snapshot([
      event(
        "44444444-4444-4444-8444-444444444444",
        "2026-08-24T13:00:00.000Z",
        "2026-08-24T14:00:00.000Z",
        { provider: "local", recurrence: ["RRULE:FREQ=WEEKLY"] },
      ),
    ]);
    local.sources[0] = {
      ...source,
      lastSyncedAt: null,
      provider: "local",
      recurrencePresent: true,
      remoteCalendarId: null,
    };

    expect(
      assessCalendar(local).findings.find(({ kind }) => kind === "recurrence_unassessed")
        ?.sourceReferences[0]?.remoteId,
    ).toBe(source.calendarId);
  });

  it("does not misrepresent a local UUID as the remote ID of a provider event", () => {
    const result = assessCalendar(
      snapshot([
        event(
          "44444444-4444-4444-8444-444444444444",
          "2026-08-24T13:00:00.000Z",
          "2026-08-24T14:00:00.000Z",
          { remoteEventId: null, status: "tentative" },
        ),
      ]),
    );

    expect(result.findings[0]?.sourceReferences[0]).toMatchObject({
      provider: "google",
      remoteId: null,
    });
  });

  it("blocks empty source evidence instead of producing a maintained assessment", () => {
    const missing = snapshot([]);
    missing.sources = [];

    const result = assessCalendar(missing);

    expect(result.state).toBe("blocked");
    expect(result.health.find(({ dimension }) => dimension === "source_trust")).toMatchObject({
      signal: "unknown",
      summary: "No selected Calendar source is available to assess.",
    });
  });

  it("bounds event and finding work and marks truncated evidence partial", () => {
    const events = Array.from({ length: 16 }, (_, index) =>
      event(
        `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`,
        "2026-08-24T13:00:00.000Z",
        "2026-08-24T14:00:00.000Z",
      ),
    );
    const limited = snapshot(events);
    limited.evidenceLimits.eventBudgetExceeded = true;

    const result = assessCalendar(limited);

    expect(result.findings).toHaveLength(CALENDAR_ASSESSMENT_BUDGETS.findings);
    expect(result.evidenceLimited).toBe(true);
    expect(result.state).toBe("blocked");
    expect(result.sourceFreshness[0]).toMatchObject({ completeness: "partial" });
  });

  it("uses provider remote event identity in material references", () => {
    const result = assessCalendar(
      snapshot([
        event(
          "44444444-4444-4444-8444-444444444444",
          "2026-08-24T13:00:00.000Z",
          "2026-08-24T14:00:00.000Z",
          { status: "tentative" },
        ),
      ]),
    );

    expect(result.findings[0]?.sourceReferences[0]?.remoteId).toBe(
      "44444444-4444-4444-8444-444444444444-remote",
    );
  });
});
