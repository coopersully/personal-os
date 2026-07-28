import type { Calendar, ParsedPreviewCalendarCommitmentInput } from "@personal-os/domain";
import { buildCalendarCommitmentProposal } from "./calendar-proposal.js";

const calendarId = "11111111-1111-4111-8111-111111111111";
const accountId = "22222222-2222-4222-8222-222222222222";
const localDestination: Calendar = {
  accountId,
  color: null,
  id: calendarId,
  isPrimary: true,
  isSelected: true,
  isWritable: true,
  lastSyncedAt: null,
  name: "Personal",
  provider: "local",
  source: {
    accountLabel: "Local",
    remoteCalendarId: null,
    syncError: null,
    syncStatus: "idle",
  },
  timezone: "UTC",
};
const baseInput: ParsedPreviewCalendarCommitmentInput = {
  candidate: {
    allDay: false,
    buffer: { afterMinutes: 0, beforeMinutes: 0 },
    calendarId,
    endsAt: "2026-08-01T17:00:00.000Z",
    evidence: {
      kind: "booking",
      source: {
        accountId,
        provider: "google",
        remoteId: "booking-1",
        revision: "v1",
        sourceType: "mail_thread",
      },
      summary: "Confirmed reservation.",
    },
    flexibility: "hard",
    location: null,
    notes: null,
    startsAt: "2026-08-01T16:00:00.000Z",
    timezone: "UTC",
    title: "Reservation",
    visibility: "private",
  },
  expectedProfileVersion: null,
  profileId: null,
  requestedPolicy: "preview",
};

describe("Calendar commitment proposal policy", () => {
  it("keeps a normal caller candidate preview-only with a stable payload fingerprint", () => {
    const proposal = buildCalendarCommitmentProposal(baseInput, {
      destination: localDestination,
      evaluatedAt: new Date("2026-07-28T15:00:00.000Z"),
      possibleDuplicateEventId: null,
      profile: null,
    });
    expect(proposal).toMatchObject({
      authority: "caller_supplied_unverified",
      policy: {
        canApply: false,
        effectivePolicy: "preview",
        reasons: [expect.stringContaining("does not authorize a write")],
        requiresInteractiveApproval: true,
      },
      providerEffect: "local_write",
    });
    expect(proposal.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(
      buildCalendarCommitmentProposal(baseInput, {
        destination: localDestination,
        evaluatedAt: new Date("2026-07-28T15:00:00.000Z"),
        possibleDuplicateEventId: null,
        profile: null,
      }).fingerprint,
    ).toBe(proposal.fingerprint);
  });

  it("treats read-only policy as non-interactive and never applicable", () => {
    const proposal = buildCalendarCommitmentProposal(
      { ...baseInput, requestedPolicy: "read_only" },
      {
        destination: localDestination,
        evaluatedAt: new Date("2026-07-28T15:00:00.000Z"),
        possibleDuplicateEventId: null,
        profile: null,
      },
    );
    expect(proposal.policy).toMatchObject({
      canApply: false,
      effectivePolicy: "read_only",
      requiresInteractiveApproval: false,
    });
  });

  it("keeps approve-each interactive and reports a missing expected profile", () => {
    const proposal = buildCalendarCommitmentProposal(
      {
        ...baseInput,
        expectedProfileVersion: 1,
        requestedPolicy: "approve_each",
      },
      {
        destination: localDestination,
        evaluatedAt: new Date("2026-07-28T15:00:00.000Z"),
        possibleDuplicateEventId: null,
        profile: null,
      },
    );
    expect(proposal.policy).toMatchObject({
      canApply: false,
      effectivePolicy: "preview",
      requiresInteractiveApproval: true,
    });
    expect(proposal.policy.reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining("does not exist"),
        expect.stringContaining("interactive Calendar action"),
      ]),
    );
  });

  it("warns when an idle provider projection is older than the freshness window", () => {
    const proposal = buildCalendarCommitmentProposal(baseInput, {
      destination: {
        ...localDestination,
        lastSyncedAt: "2026-07-28T14:50:00.000Z",
        provider: "google",
        source: {
          accountLabel: "Google",
          remoteCalendarId: "remote-calendar",
          syncError: null,
          syncStatus: "idle",
        },
      },
      evaluatedAt: new Date("2026-07-28T15:00:00.000Z"),
      possibleDuplicateEventId: null,
      profile: null,
    });
    expect(proposal.warnings).toContainEqual(expect.stringContaining("not fully fresh"));
  });

  it("explains every degraded or misleading rule-authorized condition", () => {
    const remoteDestination: Calendar = {
      ...localDestination,
      isWritable: false,
      lastSyncedAt: null,
      name: "Connected",
      provider: "google",
      source: {
        accountLabel: "Google",
        remoteCalendarId: "remote-calendar",
        syncError: "Reconnect required",
        syncStatus: "error",
      },
    };
    const proposal = buildCalendarCommitmentProposal(
      {
        ...baseInput,
        candidate: {
          ...baseInput.candidate,
          buffer: { afterMinutes: 15, beforeMinutes: 15 },
          evidence: {
            ...baseInput.candidate.evidence,
            kind: "other",
            source: {
              accountId: null,
              provider: "google",
              remoteId: null,
              revision: null,
              sourceType: "mail_thread",
            },
          },
          flexibility: "flexible",
        },
        expectedProfileVersion: 2,
        profileId: calendarId,
        requestedPolicy: "approved_rule",
      },
      {
        destination: remoteDestination,
        evaluatedAt: new Date("2026-07-28T15:00:00.000Z"),
        possibleDuplicateEventId: calendarId,
        profile: {
          preferences: {
            afterBufferMinutes: 0,
            automaticEventCreation: true,
            automaticEventEvidence: ["ticket"],
            beforeBufferMinutes: 0,
            busyBlockPrivacy: "busy",
            defaultCalendarId: accountId,
            defaultTimezone: "UTC",
          },
          status: "active",
          version: 1,
        },
      },
    );
    expect(proposal.policy.reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining("read-only"),
        expect.stringContaining("error state"),
        expect.stringContaining("completed Calendar sync"),
        expect.stringContaining("eligible evidence shape"),
        expect.stringContaining("Flexible commitments"),
        expect.stringContaining("profile version changed"),
        expect.stringContaining("not authority"),
      ]),
    );
    expect(proposal.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("possible duplicate"),
        expect.stringContaining("does not list this evidence"),
        expect.stringContaining("default destination"),
        expect.stringContaining("connected provider"),
        expect.stringContaining("not fully fresh"),
        expect.stringContaining("Buffer preferences"),
      ]),
    );
  });
});
