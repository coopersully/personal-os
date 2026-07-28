import type { UpsertDomainProfileInput } from "@personal-os/domain";
import { normalizeDomainProfilePreferences } from "./domain-profile-validation.js";

const baseProfile: Omit<UpsertDomainProfileInput, "domain" | "preferences"> = {
  categories: [],
  instructions: [],
  objective: "Keep commitments visible.",
  sourceContexts: [],
  status: "draft",
  summary: "Review overdue commitments.",
};

describe("domain profile validation", () => {
  it("normalizes partial drafts and requires complete new active profiles", () => {
    expect(
      normalizeDomainProfilePreferences({
        ...baseProfile,
        domain: "reminders",
        preferences: { priorityHighMeaning: "  Needs attention today  " },
      }),
    ).toEqual({ priorityHighMeaning: "Needs attention today" });
    expect(() =>
      normalizeDomainProfilePreferences({
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
        status: "active",
      }),
    ).not.toThrow();
    expect(() =>
      normalizeDomainProfilePreferences({
        ...baseProfile,
        domain: "reminders",
        preferences: {},
        status: "active",
      }),
    ).toThrow();
  });

  it("preserves unchanged legacy active profiles and generic domains", () => {
    expect(
      normalizeDomainProfilePreferences(
        {
          ...baseProfile,
          domain: "reminders",
          preferences: {},
          status: "active",
        },
        { preferences: {}, status: "active" },
      ),
    ).toEqual({});
    expect(() =>
      normalizeDomainProfilePreferences({
        ...baseProfile,
        domain: "mail",
        preferences: { inboxStyle: "signal_only" },
      } satisfies UpsertDomainProfileInput),
    ).not.toThrow();
  });
});
