import { MAIL_PLAYBOOK, mailPlaybookNeedsResearchReview } from "./mail-playbook.js";

describe("Mail stewardship playbook", () => {
  it("publishes researched roles without enlarging Mail authority", () => {
    expect(MAIL_PLAYBOOK.version).toBe("1.0.0");
    expect(MAIL_PLAYBOOK.roles.map((role) => role.id)).toEqual([
      "chief_of_staff",
      "correspondence_triager",
      "executive_assistant",
      "records_clerk",
      "security_reviewer",
      "communications_adviser",
    ]);
    expect(MAIL_PLAYBOOK.automatic).toEqual([
      "inspect",
      "reconcile_ilo_state",
      "deduplicate_questions",
      "publish_review",
    ]);
    expect(MAIL_PLAYBOOK.unavailable).toEqual(
      expect.arrayContaining([
        "compose_email",
        "draft_email",
        "reply_email",
        "forward_email",
        "send_email",
      ]),
    );
    expect(MAIL_PLAYBOOK.approvedRule).not.toContain("send_email");
    expect(MAIL_PLAYBOOK.individualApproval).not.toContain("send_email");
  });

  it("makes research review timing explicit and conservative", () => {
    expect(MAIL_PLAYBOOK.research.find(({ id }) => id === "cisa-phishing")?.url).toBe(
      "https://www.cisa.gov/secure-our-world/recognize-and-report-phishing",
    );
    expect(mailPlaybookNeedsResearchReview(new Date("2026-08-25T00:00:00.000Z"))).toEqual([]);
    expect(mailPlaybookNeedsResearchReview(new Date("2027-02-12T00:00:00.000Z"))).toEqual(
      expect.arrayContaining(["nist-sp-800-177-r1", "cisa-phishing", "gmail-labels"]),
    );
  });
});
