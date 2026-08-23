import { describe, expect, it } from "vitest";
import {
  calendarMaintenanceLifecycleSchema,
  calendarReviewSchema,
  calendarStatusSchema,
  createCalendarReviewInputSchema,
} from "./calendar-stewardship.js";

const now = "2026-08-23T16:00:00.000Z";
const id = "11111111-1111-4111-8111-111111111111";

describe("Calendar stewardship contracts", () => {
  it("defaults review creation to the server-owned all-outstanding scope", () => {
    expect(createCalendarReviewInputSchema.parse({})).toEqual({ scope: { type: "all_outstanding" } });
  });

  it("retains the complete target lifecycle even when this slice reaches only settled review states", () => {
    expect(calendarMaintenanceLifecycleSchema.options).toEqual([
      "never_maintained",
      "stale",
      "queued",
      "active",
      "maintained",
      "maintained_with_questions",
      "blocked",
      "failed",
    ]);
  });

  it("rejects a false healthy status with unavailable source evidence", () => {
    const parsed = calendarStatusSchema.safeParse({
      asOf: now,
      readiness: "degraded",
      setupBlockers: [],
      lifecycle: "blocked",
      sources: [
        {
          accountId: id,
          calendarId: id,
          completeness: "complete",
          evidenceCutoff: now,
          lastSyncedAt: null,
          provider: "google",
          readable: true,
          reason: "Authorization must be renewed.",
          recovery: "reconnect",
          state: "unavailable",
          writable: true,
        },
      ],
      authority: {
        approvedRule: [],
        automatic: ["inspect", "assess"],
        individualApproval: ["create_event", "move_event", "resize_event", "trash_event", "restore_event"],
        unavailable: ["rsvp", "invite", "cancel_attended_event", "book_travel", "send_correspondence"],
      },
      backlog: {
        actionable: null,
        ambiguousEffects: null,
        awaitingApproval: null,
        awaitingInput: null,
        blocked: 1,
        failed: null,
        openFindings: null,
      },
      health: [
        {
          dimension: "source_trust",
          evidenceFindingIds: [],
          signal: "healthy",
          summary: "Sources are current.",
        },
      ],
      latestReview: null,
      validNextOperations: ["assess_calendar", "open_connections"],
    });
    expect(parsed.success).toBe(false);
  });

  it.each(["partial", "unknown"] as const)(
    "rejects a healthy source-trust status with %s source completeness",
    (completeness) => {
      const parsed = calendarStatusSchema.safeParse({
        asOf: now,
        readiness: "degraded",
        setupBlockers: [],
        lifecycle: "stale",
        sources: [
          {
            accountId: id,
            calendarId: id,
            completeness,
            evidenceCutoff: now,
            lastSyncedAt: now,
            provider: "google",
            readable: true,
            reason: null,
            recovery: null,
            state: "current",
            writable: true,
          },
        ],
        authority: {
          approvedRule: [],
          automatic: ["inspect", "assess"],
          individualApproval: [],
          unavailable: [],
        },
        backlog: {
          actionable: null,
          ambiguousEffects: null,
          awaitingApproval: null,
          awaitingInput: null,
          blocked: 0,
          failed: null,
          openFindings: null,
        },
        health: [
          {
            dimension: "source_trust",
            evidenceFindingIds: [],
            signal: "healthy",
            summary: "Sources are current.",
          },
        ],
        latestReview: null,
        validNextOperations: ["assess_calendar"],
      });
      expect(parsed.success).toBe(false);
    },
  );

  it("rejects maintained-with-questions status with stale or incomplete source evidence", () => {
    const parsed = calendarStatusSchema.safeParse({
      asOf: now,
      readiness: "degraded",
      setupBlockers: [],
      lifecycle: "maintained_with_questions",
      sources: [
        {
          accountId: id,
          calendarId: id,
          completeness: "partial",
          evidenceCutoff: now,
          lastSyncedAt: now,
          provider: "google",
          readable: true,
          reason: null,
          recovery: null,
          state: "stale",
          writable: true,
        },
      ],
      authority: {
        approvedRule: [],
        automatic: ["inspect", "assess"],
        individualApproval: [],
        unavailable: [],
      },
      backlog: {
        actionable: null,
        ambiguousEffects: null,
        awaitingApproval: null,
        awaitingInput: null,
        blocked: 0,
        failed: null,
        openFindings: null,
      },
      health: [
        {
          dimension: "source_trust",
          evidenceFindingIds: [],
          signal: "unknown",
          summary: "No selected Calendar source is available to assess.",
        },
      ],
      latestReview: null,
      validNextOperations: ["assess_calendar"],
    });
    expect(parsed.success).toBe(false);
  });

  it("keeps review evidence redacted and revision-bound", () => {
    const review = calendarReviewSchema.parse({
      createdAt: now,
      evidenceCutoff: now,
      findings: [],
      health: [
        {
          dimension: "source_trust",
          evidenceFindingIds: [],
          signal: "unknown",
          summary: "No selected Calendar source is available to assess.",
        },
      ],
      id,
      ledgerFingerprint: "a".repeat(64),
      nextMaintenanceAt: "2026-08-23T16:15:00.000Z",
      playbookVersion: "1.0.0",
      profileVersion: null,
      recommendations: [],
      rulebookVersion: "calendar-profile/none",
      scope: { type: "all_outstanding" },
      scopeEnd: "2026-11-21T16:00:00.000Z",
      scopeStart: "2026-07-24T16:00:00.000Z",
      sourceFreshness: [],
      state: "blocked",
    });
    expect(JSON.stringify(review)).not.toMatch(/credentials|raw|attendee|notes|location|title/i);
  });

  it("rejects maintained reviews and statuses without selected source evidence", () => {
    const maintainedReview = {
      createdAt: now,
      evidenceCutoff: now,
      findings: [],
      health: [],
      id,
      ledgerFingerprint: "a".repeat(64),
      nextMaintenanceAt: "2026-08-23T16:15:00.000Z",
      playbookVersion: "1.0.0",
      profileVersion: null,
      recommendations: [],
      rulebookVersion: "calendar-profile/none",
      scope: { type: "all_outstanding" as const },
      scopeEnd: "2026-11-21T16:00:00.000Z",
      scopeStart: "2026-07-24T16:00:00.000Z",
      sourceFreshness: [],
      state: "maintained" as const,
    };
    expect(calendarReviewSchema.safeParse(maintainedReview).success).toBe(false);
    expect(
      calendarStatusSchema.safeParse({
        asOf: now,
        authority: { approvedRule: [], automatic: ["inspect", "assess"], individualApproval: [], unavailable: [] },
        backlog: { actionable: null, ambiguousEffects: null, awaitingApproval: null, awaitingInput: null, blocked: 0, failed: null, openFindings: null },
        health: [],
        latestReview: null,
        lifecycle: "maintained",
        readiness: "setup_required",
        setupBlockers: ["Select a source."],
        sources: [],
        validNextOperations: ["assess_calendar"],
      }).success,
    ).toBe(false);
  });
});
