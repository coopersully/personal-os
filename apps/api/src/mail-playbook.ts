export const MAIL_PLAYBOOK = Object.freeze({
  approvedRule: ["mark_read", "mark_unread", "star", "unstar", "archive", "move"],
  automatic: ["inspect", "reconcile_ilo_state", "deduplicate_questions", "publish_review"],
  defaultObjective: "Keep known mail obligations explicit, current, and reviewable.",
  freshness: { currentWithinMinutes: 30 },
  individualApproval: ["trash", "activate_rule"],
  limitations: [
    "Message prose does not prove user intent.",
    "Security-review obligations require explicit evidence or user confirmation in v1.",
    "No model or external client supplies maintenance judgment.",
  ],
  questionPolicy: { dedupeVersion: 1, maxOpenPerThread: 1 },
  releaseId: "mail-playbook-v1",
  research: [
    {
      id: "uk-correspondence",
      reviewEveryDays: 365,
      reviewedAt: "2026-08-15",
      url: "https://www.gov.uk/government/publications/handling-government-correspondence-guidance",
    },
    {
      id: "nara-electronic-messages",
      reviewEveryDays: 365,
      reviewedAt: "2026-08-15",
      url: "https://www.archives.gov/records-mgmt/bulletins/2015/2015-02.html",
    },
    {
      id: "nist-sp-800-177-r1",
      reviewEveryDays: 180,
      reviewedAt: "2026-08-15",
      url: "https://csrc.nist.gov/pubs/sp/800/177/r1/final",
    },
    {
      id: "cisa-phishing",
      reviewEveryDays: 180,
      reviewedAt: "2026-08-15",
      url: "https://www.cisa.gov/secure-our-world/recognize-and-report-phishing",
    },
    {
      id: "gmail-labels",
      reviewEveryDays: 180,
      reviewedAt: "2026-08-15",
      url: "https://developers.google.com/workspace/gmail/api/guides/labels",
    },
  ],
  roles: [
    {
      id: "chief_of_staff",
      limit: "Never infer goals, make relationship decisions, or claim executive authority.",
      responsibility:
        "Relate explicit correspondence evidence to approved goals, commitments, relationships, dependencies, deadlines, and opportunity cost.",
    },
    {
      id: "correspondence_triager",
      limit:
        "Never import government service levels or decide that silence is acceptable for the user.",
      responsibility:
        "Represent materiality, response need, routing, ownership, urgency, and follow-up as evidence-bound candidates.",
    },
    {
      id: "executive_assistant",
      limit: "Never create Calendar events automatically; Mail evidence remains a proposal.",
      responsibility:
        "Surface candidate dates, commitments, dependencies, and waiting-for relationships.",
    },
    {
      id: "records_clerk",
      limit: "Never assign legal retention, declare a record, or override a legal hold.",
      responsibility:
        "Preserve provenance, attachments, thread relationships, retrieval, and approved retention meaning.",
    },
    {
      id: "security_reviewer",
      limit:
        "Never certify authenticity, classify spam, open links, execute attachments, or replace a security professional.",
      responsibility:
        "Surface observed suspicious signals and unsafe requests while separating fact from inference.",
    },
    {
      id: "communications_adviser",
      limit: "Never create transmittable correspondence, select recipients, or send.",
      responsibility:
        "Structure private response purpose, facts, questions, tone considerations, and required materials.",
    },
  ],
  unavailable: ["compose_email", "draft_email", "reply_email", "forward_email", "send_email"],
  version: "1.0.0",
} as const);

export type MailPlaybook = typeof MAIL_PLAYBOOK;

const millisecondsPerDay = 86_400_000;

export function mailPlaybookNeedsResearchReview(at: Date): string[] {
  return MAIL_PLAYBOOK.research
    .filter((source) => {
      const reviewedAt = new Date(`${source.reviewedAt}T00:00:00.000Z`);
      return at.getTime() - reviewedAt.getTime() >= source.reviewEveryDays * millisecondsPerDay;
    })
    .map((source) => source.id);
}
