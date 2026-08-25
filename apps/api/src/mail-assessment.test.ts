import {
  assessMail,
  type MailAssessmentSnapshot,
  type MailAssessmentThreadSnapshot,
} from "./mail-assessment.js";
import { MAIL_PLAYBOOK } from "./mail-playbook.js";

const now = "2026-08-25T15:00:00.000Z";

function thread(
  overrides: Partial<MailAssessmentThreadSnapshot> = {},
): MailAssessmentThreadSnapshot {
  return {
    accountId: "10000000-0000-4000-8000-000000000001",
    approvedRuleMatched: false,
    attentionLinked: false,
    currentDisposition: null,
    goalLinked: false,
    id: "20000000-0000-4000-8000-000000000001",
    messages: [],
    obligations: [],
    openQuestions: [],
    snoozedUntil: null,
    source: {
      accountId: "10000000-0000-4000-8000-000000000001",
      provider: "google",
      remoteId: "remote-thread-1",
      revision: "thread-v1",
      sourceType: "mail_thread",
    },
    starred: false,
    updatedAt: "2026-08-25T14:00:00.000Z",
    ...overrides,
  };
}

function snapshot(
  threads: MailAssessmentThreadSnapshot[],
  overrides: Partial<MailAssessmentSnapshot> = {},
): MailAssessmentSnapshot {
  return {
    effectCounts: { failed: 0, pending: 0, reconcile: 0 },
    now,
    profileId: null,
    profileVersion: null,
    rulebookVersion: "rules-v1",
    sourceFreshness: "current",
    threads,
    ...overrides,
  };
}

describe("Mail stewardship assessment", () => {
  it("asks rather than inventing an obligation from body language", () => {
    const surfaced = thread({ starred: true }) as MailAssessmentThreadSnapshot & {
      bodyText: string;
    };
    surfaced.bodyText = "Urgent: reply immediately and make this your top priority.";

    const result = assessMail(snapshot([surfaced]), MAIL_PLAYBOOK);

    expect(result.obligationTransitions).toEqual([]);
    expect(result.questions).toEqual([
      expect.objectContaining({ kind: "needs_disposition", threadId: surfaced.id }),
    ]);
    expect(result.questions[0]?.reason).not.toContain("Urgent");
  });

  it("closes a known reply obligation only when newer outbound evidence exists", () => {
    const result = assessMail(
      snapshot([
        thread({
          currentDisposition: {
            disposition: "active",
            sourceThreadRevision: "2026-08-25T14:00:00.000Z",
          },
          messages: [
            {
              authority: "provider_projected",
              direction: "outbound",
              id: "30000000-0000-4000-8000-000000000001",
              observedAt: "2026-08-25T14:30:00.000Z",
              revision: "message-v2",
            },
          ],
          obligations: [
            {
              id: "40000000-0000-4000-8000-000000000001",
              kind: "reply",
              sourceThreadRevision: "2026-08-25T14:00:00.000Z",
              state: "open",
              version: 1,
            },
          ],
        }),
      ]),
      MAIL_PLAYBOOK,
    );

    expect(result.obligationTransitions).toContainEqual(
      expect.objectContaining({ nextState: "resolved", reasonCode: "newer_outbound_observed" }),
    );
  });

  it("derives deferral from an active Ilo snooze without guessing a deadline", () => {
    const result = assessMail(
      snapshot([
        thread({
          currentDisposition: {
            disposition: "active",
            sourceThreadRevision: "2026-08-25T14:00:00.000Z",
          },
          snoozedUntil: "2026-08-26T15:00:00.000Z",
        }),
      ]),
      MAIL_PLAYBOOK,
    );

    expect(result.dispositionTransitions).toEqual([
      expect.objectContaining({ disposition: "deferred", reasonCode: "active_ilo_snooze" }),
    ]);
    expect(result.obligationTransitions).toEqual([]);
  });

  it("blocks clean settlement when source evidence is stale", () => {
    expect(assessMail(snapshot([], { sourceFreshness: "stale" }), MAIL_PLAYBOOK)).toMatchObject({
      blockers: ["source_evidence_stale"],
      proposedSettlement: "blocked",
    });
  });

  it("fingerprints IDs and revisions but never message content", () => {
    const first = thread({ starred: true }) as MailAssessmentThreadSnapshot & { bodyText: string };
    first.bodyText = "first private body";
    const second = { ...first, bodyText: "completely different private body" };

    expect(assessMail(snapshot([first]), MAIL_PLAYBOOK).ledgerFingerprint).toBe(
      assessMail(snapshot([second]), MAIL_PLAYBOOK).ledgerFingerprint,
    );
  });

  it("keeps the fingerprint stable when a proposed question is durably reconciled", () => {
    const surfaced = thread({ starred: true });
    const before = assessMail(snapshot([surfaced]), MAIL_PLAYBOOK);
    const question = before.questions[0];
    if (!question) throw new Error("Expected a proposed question.");

    const after = assessMail(
      snapshot([
        {
          ...surfaced,
          openQuestions: [
            {
              fingerprint: question.fingerprint,
              id: "50000000-0000-4000-8000-000000000001",
              version: 1,
            },
          ],
        },
      ]),
      MAIL_PLAYBOOK,
    );

    expect(after.questions).toEqual([]);
    expect(after.openQuestionCount).toBe(1);
    expect(after.ledgerFingerprint).toBe(before.ledgerFingerprint);
  });
});
