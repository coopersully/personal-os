import {
  createMailObligationInputSchema,
  mailResponseBriefSchema,
  mailStatusSchema,
} from "./mail-stewardship.js";

const now = "2026-08-25T12:00:00.000Z";
const id = "11111111-1111-4111-8111-111111111111";
const cleanStatus = {
  activeRun: null,
  asOf: now,
  details: {
    authority: {
      approvedRule: ["apply_approved_rule"],
      automatic: ["inspect", "reconcile_ilo_state", "publish_review"],
      individualApproval: ["trash", "activate_rule"],
      unavailable: ["compose_email", "reply_email", "forward_email", "send_email"],
    },
    dispositionCounts: {
      active: 0,
      deferred: 0,
      delegated: 0,
      noise: 0,
      reference: 0,
      resolved: 0,
      waiting: 0,
    },
    effectCounts: { failed: 0, pending: 0, reconcile: 0 },
    health: [
      {
        dimension: "source_trust",
        evidenceIds: [],
        signal: "healthy",
        summary: "Connected sources are current.",
      },
    ],
    latestReview: null,
    objective: {
      mode: "default_obligation_integrity",
      profileId: null,
      profileVersion: null,
      summary: "Keep known mail obligations explicit, current, and reviewable.",
    },
    obligationCounts: { deferred: 0, dismissed: 0, open: 0, resolved: 0, waiting: 0 },
    openQuestionCount: 0,
    openQuestions: [],
    playbookVersion: "1.0.0",
    rulebookVersion: "mail-rules-v1",
  },
  domain: "mail",
  freshness: { blockers: [], observedAt: now, state: "current" },
  state: "clean",
  validNextOperations: [
    { href: "/mail/review", label: "Review Mail stewardship", operation: "review_mail" },
  ],
  work: {
    actionable: 0,
    awaitingApproval: 0,
    awaitingInput: 0,
    blocked: 0,
    oldestOutstandingAt: null,
  },
};

describe("Mail stewardship domain", () => {
  it("defaults to obligation integrity without granting transmission effects", () => {
    const status = mailStatusSchema.parse(cleanStatus);
    expect(status.details.objective.mode).toBe("default_obligation_integrity");
    expect(status.details.authority.unavailable).toContain("send_email");
    expect(status.validNextOperations.map(({ operation }) => operation)).not.toContain("send_mail");
  });

  it("requires revision-bound evidence and a rationale for every obligation", () => {
    expect(
      createMailObligationInputSchema.safeParse({
        kind: "reply",
        owner: { kind: "user" },
        rationale: "",
        sourceMessageId: null,
        sourceThreadRevision: now,
      }).success,
    ).toBe(false);
  });

  it("cannot settle clean with stale sources or unanswered material questions", () => {
    expect(
      mailStatusSchema.safeParse({
        ...cleanStatus,
        freshness: { ...cleanStatus.freshness, state: "stale" },
      }).success,
    ).toBe(false);
    expect(
      mailStatusSchema.safeParse({
        ...cleanStatus,
        details: { ...cleanStatus.details, openQuestionCount: 1 },
      }).success,
    ).toBe(false);
  });

  it("keeps response guidance structured and permanently non-transmittable", () => {
    const brief = mailResponseBriefSchema.parse({
      evidence: [
        {
          accountId: id,
          provider: "google",
          remoteId: "remote-thread",
          revision: now,
          sourceType: "mail_thread",
        },
      ],
      factsToAddress: ["Confirm the approved delivery date."],
      materialsNeeded: [],
      openQuestions: [],
      purpose: "Prepare for the user's own response.",
      sourceThreadRevision: now,
      toneConsiderations: ["Direct"],
      transmittable: false,
    });
    expect(brief.transmittable).toBe(false);
    expect(brief).not.toHaveProperty("body");
    expect(brief).not.toHaveProperty("recipients");
  });
});
