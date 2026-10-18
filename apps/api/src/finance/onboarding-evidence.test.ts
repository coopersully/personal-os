import type { Database } from "@personal-os/database";
import {
  deriveFinanceOnboardingReadiness,
  financeAccountSchema,
  financeProfileVersionSchema,
  projectFinanceConversationReadiness,
  resolveWorkspaceSettings,
} from "@personal-os/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../errors.js";
import {
  createFinanceOnboardingEvidenceLoader,
  type FinanceOnboardingEvidenceInput,
  projectFinanceOnboardingEvidence,
} from "./onboarding-evidence.js";

const id = "11111111-1111-4111-8111-111111111111";
const at = "2026-10-18T12:00:00.000Z";
function account() {
  return financeAccountSchema.parse({
    id,
    name: "Checking",
    institution: "Manual",
    balance: null,
    currencyCode: "USD",
    kind: "cash",
    kindSource: "user",
    includeInPlanning: true,
    ownershipType: "individual",
    ownershipShare: 1,
    provider: "manual",
    providerSubtype: null,
    providerType: null,
    status: "manual",
    synchronization: {
      failureCode: null,
      failureCount: 0,
      lastAttemptAt: null,
      lastSuccessAt: null,
      message: null,
      nextRetryAt: null,
      recovery: null,
      state: "current",
    },
    createdAt: at,
    updatedAt: at,
    lastSyncedAt: null,
  });
}
function input(): FinanceOnboardingEvidenceInput {
  return {
    profile: null,
    accounts: [account()],
    preferences: resolveWorkspaceSettings("finances", undefined).preferences,
    goals: [],
    existingAccess: false,
    registrationCount: 0,
    authorizedRegistrationWithCadence: false,
    chat: projectFinanceConversationReadiness({
      registrationState: "missing",
      connectionState: "missing",
      messageCapability: "unverified",
      executionAuthorized: false,
    }),
  };
}
function profile() {
  return financeProfileVersionSchema.parse({
    id,
    userId: id,
    version: 1,
    createdAt: at,
    jurisdiction: "US",
    householdSize: 1,
    expectedMonthlyTakeHome: 0,
    liquidReserves: 0,
    incomeStability: "unknown",
    debts: [],
    dependents: null,
    insurance: [],
    preferences: {
      bufferTarget: null,
      debtPriority: null,
      emergencyReserveMonths: null,
      notes: [],
    },
    planning: { obligations: [] },
    provenance: {},
  });
}

describe("Finance onboarding canonical evidence", () => {
  it("includes every essential stable question without imposing a budget and keeps missing facts unreviewed", () => {
    const result = projectFinanceOnboardingEvidence(input());
    expect(result.questions.map((q) => q.questionId).sort()).toEqual(
      [
        "planning:obligations",
        "profile:debts",
        "profile:goals",
        "profile:household_size",
        "profile:income_stability",
        "profile:liquid_reserves",
        "profile:location",
        "profile:monthly_take_home",
      ].sort(),
    );
    expect(result.questions.every((q) => q.disposition === "unreviewed")).toBe(true);
    expect(result.contextReview).toBe("reviewed");
  });
  it("preserves explicit canonical zeros and does not interpret missing debt provenance or unknown stability as answered", () => {
    const value = input();
    value.profile = profile();
    const questions = projectFinanceOnboardingEvidence(value).questions;
    expect(questions.find((q) => q.questionId === "profile:monthly_take_home")).toMatchObject({
      disposition: "answered",
      answerSummary: "$0.00 monthly take-home",
    });
    expect(questions.find((q) => q.questionId === "profile:liquid_reserves")?.disposition).toBe(
      "answered",
    );
    expect(questions.find((q) => q.questionId === "profile:debts")?.disposition).toBe("unreviewed");
    expect(questions.find((q) => q.questionId === "profile:income_stability")?.disposition).toBe(
      "unreviewed",
    );
    expect(questions.find((q) => q.questionId === "planning:obligations")).toMatchObject({
      disposition: "answered",
      answerSummary: "No bills or debt minimums",
      allowsNone: true,
    });
  });
  it("recognizes explicitly recorded no-debt facts only with canonical provenance", () => {
    const value = input();
    value.profile = profile();
    value.profile.provenance.debts = {
      actorId: id,
      actorType: "user",
      confidence: 1,
      evidence: {},
      maintenanceRunId: null,
      observedAt: at,
      requestId: "review",
      sourceId: null,
    };
    expect(
      projectFinanceOnboardingEvidence(value).questions.find(
        (q) => q.questionId === "profile:debts",
      ),
    ).toMatchObject({ disposition: "answered", answerSummary: "No debts", allowsNone: true });
  });
  it("formats canonical major currency units without relabeling them as cents", () => {
    const value = input();
    value.profile = profile();
    value.profile.expectedMonthlyTakeHome = 1234.56;
    expect(
      projectFinanceOnboardingEvidence(value).questions.find(
        (q) => q.questionId === "profile:monthly_take_home",
      )?.answerSummary,
    ).toBe("$1,234.56 monthly take-home");
  });
  it("reviews canonical goal priorities without creating a copied goal or fabricating an empty answer", () => {
    const value = input();
    value.goals = [
      { name: "Reserve", priority: "high", status: "active" },
      { name: "Removed", priority: "low", status: "removed" },
    ];
    expect(
      projectFinanceOnboardingEvidence(value).questions.find(
        (q) => q.questionId === "profile:goals",
      ),
    ).toMatchObject({
      disposition: "answered",
      answerSummary: "Reserve (high priority)",
      allowsNone: true,
    });
  });
  it("requires included source ownership and ignores excluded unresolved sources", () => {
    const value = input();
    value.accounts[0] = { ...account(), ownershipType: "unknown", ownershipShare: null };
    expect(projectFinanceOnboardingEvidence(value).source.state).toBe("ownership_required");
    value.accounts[0] = { ...account(), ownershipType: "joint", ownershipShare: null };
    expect(projectFinanceOnboardingEvidence(value).source.state).toBe("ownership_required");
    value.accounts[0] = { ...account(), ownershipType: "joint", ownershipShare: 0.5 };
    value.accounts.push({
      ...account(),
      includeInPlanning: false,
      ownershipType: "unknown",
      ownershipShare: null,
    });
    expect(projectFinanceOnboardingEvidence(value).source.state).toBe("usable");
    value.accounts = value.accounts.map((a) => ({ ...a, includeInPlanning: false }));
    expect(projectFinanceOnboardingEvidence(value).source.state).toBe("missing");
  });
  it("allows syncing sources while keeping failed source recovery honest", () => {
    const value = input();
    value.accounts[0] = {
      ...account(),
      status: "connected",
      synchronization: { ...account().synchronization, state: "retrying" },
    };
    expect(projectFinanceOnboardingEvidence(value).source.state).toBe("syncing");
    value.accounts[0] = { ...account(), status: "needs_reauth" };
    expect(projectFinanceOnboardingEvidence(value).source.state).toBe("unavailable");
    value.accounts.push(account());
    expect(projectFinanceOnboardingEvidence(value).source.state).toBe("usable");
  });
  it("keeps registration cadence independent from verified Chat and projects unavailable Chat without blocking manual completion", () => {
    const value = input();
    value.registrationCount = 1;
    value.authorizedRegistrationWithCadence = true;
    value.chat = null;
    const result = projectFinanceOnboardingEvidence(value);
    expect(result.automation).toMatchObject({
      registrationCount: 1,
      authorizedRegistrationWithCadence: true,
      chatVerification: "unavailable",
      canSendChat: false,
      historyAvailable: true,
    });
    const snapshot = {
      ...result,
      revision: 1,
      completedAt: null,
      automationChoice: "later" as const,
      questions: result.questions.map((q) => ({ ...q, disposition: "unknown" as const })),
      displayPreferences: { ...result.displayPreferences, reviewed: true },
    };
    expect(deriveFinanceOnboardingReadiness(snapshot).canComplete).toBe(true);
    expect(
      deriveFinanceOnboardingReadiness({ ...snapshot, automationChoice: "now" }).canComplete,
    ).toBe(true);
  });
  it("uses current settings including explicit empty account scope and manual visibility", () => {
    const value = input();
    value.preferences.spendAccountIds = [];
    value.preferences.financeManualVisibility = "hide";
    const before = structuredClone(value);
    const result = projectFinanceOnboardingEvidence(value);
    expect(result.manualVisibility).toBe("hide");
    expect(result.displayPreferences.summary).toContain("Spending accounts: none selected.");
    expect(value).toEqual(before);
  });
});

const mocks = vi.hoisted(() => ({
  profile: vi.fn(),
  accounts: vi.fn(),
  settings: vi.fn(),
  chat: vi.fn(),
  execution: vi.fn(),
}));
vi.mock("./profile-budget-service.js", () => ({
  createProfileBudgetService: () => ({ getFinancialProfile: mocks.profile }),
}));
vi.mock("./account-service.js", () => ({
  createFinanceAccountService: () => ({ list: mocks.accounts }),
}));
vi.mock("../workspace-settings/service.js", () => ({
  createWorkspaceSettingsService: () => ({ get: mocks.settings }),
}));
vi.mock("./conversation-persistence.js", () => ({
  createFinanceConversationService: () => ({ getReadiness: mocks.chat }),
}));
vi.mock("../workspace-execution.js", () => ({ requireWorkspaceExecution: mocks.execution }));

function schedule(
  state: "active" | "paused" | "setup_pending" | "revoked" | "cancelled" = "active",
) {
  return {
    authorizationConnectionId: id,
    schedule: {
      id,
      tenantAuthorizationConnectionId: id,
      label: "Finance upkeep",
      hostSurface: "codex_desktop",
      hostAutomationId: state === "setup_pending" || state === "cancelled" ? null : "host-1",
      effectiveScopes: ["finances:maintain"],
      state,
      version: 1,
      createdAt: at,
      updatedAt: at,
      lastObservedAt: null,
      nextExpectedAt: state === "active" ? at : null,
      trigger: {
        type: "recurring",
        recurrence: { type: "interval", everyMinutes: 60, timeZone: "UTC" },
      },
    },
  };
}
function executor(results: unknown[][]) {
  const where = vi.fn(async () => results.shift() ?? []);
  return { select: () => ({ from: () => ({ where }) }) } as unknown as Database;
}
describe("Finance onboarding evidence loader", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.profile.mockResolvedValue({ data: null });
    mocks.accounts.mockResolvedValue({ accounts: [account()] });
    mocks.settings.mockResolvedValue(resolveWorkspaceSettings("finances", undefined));
    mocks.chat.mockResolvedValue(input().chat);
    mocks.execution.mockResolvedValue(undefined);
  });
  it("uses the admitted executor and server legacy-access port, counts paused/pending registrations independently from health", async () => {
    const db = executor([
      [],
      [schedule("paused"), schedule("setup_pending"), schedule("revoked"), schedule("cancelled")],
    ]);
    const legacy = vi.fn(async (tx, owner) => {
      expect(tx).toBe(db);
      expect(owner).toBe(id);
      return true;
    });
    const result = await createFinanceOnboardingEvidenceLoader({ hasLegacyAccess: legacy })(db, id);
    expect(result.existingAccess).toBe(true);
    expect(result.automation).toMatchObject({
      registrationCount: 2,
      authorizedRegistrationWithCadence: false,
      canSendChat: false,
    });
    expect(mocks.execution).not.toHaveBeenCalled();
  });
  it("requires live original token execution authority for cadence without requiring a Chat proof", async () => {
    const token = { id, scopes: ["finances:maintain", "finances:write", "finances:execute"] };
    const db = executor([[], [schedule()], [token]]);
    const result = await createFinanceOnboardingEvidenceLoader({
      hasLegacyAccess: async () => false,
    })(db, id);
    expect(result.automation).toMatchObject({
      registrationCount: 1,
      authorizedRegistrationWithCadence: true,
      chatVerification: "pending",
      canSendChat: false,
    });
    expect(mocks.execution).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ actorId: id, authorizationConnectionId: id }),
      "finances",
      expect.any(Date),
    );
  });
  it("rejects malformed cadence, missing maintain scope, and mismatched connection bindings", async () => {
    for (const changed of [
      {
        trigger: {
          type: "recurring",
          recurrence: { type: "interval", everyMinutes: 0, timeZone: "UTC" },
        },
      },
      { effectiveScopes: ["finances:read"] },
      { tenantAuthorizationConnectionId: "22222222-2222-4222-8222-222222222222" },
    ]) {
      const row = schedule();
      Object.assign(row.schedule, changed);
      const result = await createFinanceOnboardingEvidenceLoader({
        hasLegacyAccess: async () => false,
      })(executor([[], [row]]), id);
      expect(result.automation.authorizedRegistrationWithCadence).toBe(false);
    }
    expect(mocks.execution).not.toHaveBeenCalled();
  });
  it("treats forbidden execution as unauthorized but propagates unexpected failures", async () => {
    const token = { id, scopes: ["finances:maintain", "finances:write", "finances:execute"] };
    mocks.execution.mockRejectedValue(new AppError("forbidden", "Revoked"));
    const load = createFinanceOnboardingEvidenceLoader({ hasLegacyAccess: async () => false });
    expect(
      (await load(executor([[], [schedule()], [token]]), id)).automation
        .authorizedRegistrationWithCadence,
    ).toBe(false);
    mocks.execution.mockRejectedValue(new Error("Database failed"));
    await expect(load(executor([[], [schedule()], [token]]), id)).rejects.toThrow(
      "Database failed",
    );
  });
  it("keeps optional Chat failure unavailable and observable without inventing essential facts", async () => {
    mocks.chat.mockRejectedValue(new Error("Sensitive database message"));
    const onChatFailure = vi.fn();
    const result = await createFinanceOnboardingEvidenceLoader({
      hasLegacyAccess: async () => false,
      onChatFailure,
    })(executor([[], []]), id);
    expect(result.automation).toMatchObject({
      registrationCount: 0,
      chatVerification: "unavailable",
      canSendChat: false,
      historyAvailable: true,
    });
    expect(onChatFailure).toHaveBeenCalledExactlyOnceWith({
      category: "unexpected",
      durationMs: expect.any(Number),
    });
    mocks.profile.mockRejectedValue(new Error("Essential profile read failed"));
    await expect(
      createFinanceOnboardingEvidenceLoader({ hasLegacyAccess: async () => false })(
        executor([]),
        id,
      ),
    ).rejects.toThrow("Essential profile read failed");
  });
});
