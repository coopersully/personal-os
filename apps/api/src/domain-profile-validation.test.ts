import type { UpsertDomainProfileInput } from "@personal-os/domain";
import { validateDomainProfilePreferences } from "./domain-profile-validation.js";

const baseProfile: Omit<UpsertDomainProfileInput, "domain" | "preferences"> = {
  categories: [],
  instructions: [],
  objective: "Keep commitments visible.",
  sourceContexts: [],
  status: "draft",
  summary: "Review overdue commitments.",
};

describe("domain profile validation", () => {
  it("validates Reminder preferences through the domain registry", () => {
    expect(() =>
      validateDomainProfilePreferences({
        ...baseProfile,
        domain: "reminders",
        preferences: {
          preferredAutomaticActions: ["create", "complete"],
          defaultCapture: "due_when_stated",
          dueAtMeaning: "deadline",
          notificationLeadMinutes: "none",
          overdueBehavior: "propose_deferral",
          overdueReviewAfterDays: 2,
          priorityHighMeaning: "Needs attention today",
          priorityLowMeaning: "Optional when convenient",
          priorityMediumMeaning: "Should happen soon",
          preferredMutationPolicy: "approve_each",
          reviewPriorityAtOrAbove: "medium",
          timezoneBehavior: "ask_when_ambiguous",
        },
      }),
    ).not.toThrow();
    expect(() =>
      validateDomainProfilePreferences({
        ...baseProfile,
        domain: "reminders",
        preferences: {},
      }),
    ).toThrow();
  });

  it("leaves domains without a registered preference contract generic", () => {
    expect(() =>
      validateDomainProfilePreferences({
        ...baseProfile,
        domain: "mail",
        preferences: { inboxStyle: "signal_only" },
      } satisfies UpsertDomainProfileInput),
    ).not.toThrow();
  });
});
