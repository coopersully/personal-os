// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AgentAccessSettings } from "./agent-access.js";

const id = "11111111-1111-4111-8111-111111111111";
const now = "2026-07-28T12:00:00.000Z";

const mocks = vi.hoisted(() => ({
  activateMailRule: vi.fn(),
  createAccessToken: vi.fn(),
  deleteAccessToken: vi.fn(),
  getAgentConnectionGuide: vi.fn(),
  getAssistantSetupStatus: vi.fn(),
  getFinanceGuidedSetup: vi.fn(),
  getMailSetupContext: vi.fn(),
  listAccessTokens: vi.fn(),
  listAttentionItems: vi.fn(),
  listCalendars: vi.fn(),
  listMailRules: vi.fn(),
  listOAuthClients: vi.fn(),
  listReminders: vi.fn(),
  previewSavedMailRule: vi.fn(),
  revokeOAuthClient: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: vi.fn() },
}));

vi.mock("../../api.js", () => ({
  api: mocks,
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : "Fallback error"),
}));

function renderSettings() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AgentAccessSettings />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("agent access settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAgentConnectionGuide.mockResolvedValue({
      domains: [
        {
          domain: "mail",
          readScope: "mail:read",
          support: "executable_rules",
          writeScope: "mail:write",
        },
        {
          domain: "calendar",
          readScope: "calendar:read",
          support: "profile_and_attention",
          writeScope: "calendar:write",
        },
        {
          domain: "reminders",
          readScope: "reminders:read",
          support: "profile_and_attention",
          writeScope: "reminders:write",
        },
        {
          domain: "tasks",
          readScope: "tasks:read",
          support: "profile_and_attention",
          writeScope: "tasks:write",
        },
        {
          domain: "finances",
          readScope: "finances:read",
          support: "profile_and_attention",
          writeScope: "finances:write",
        },
        {
          domain: "goals",
          readScope: "goals:read",
          support: "profile_and_attention",
          writeScope: "goals:write",
        },
      ],
      mcpUrl: "https://mcp.example.com/mcp",
      skill: {
        displayName: "Ilo Guided Setup",
        installPrompt: "Install the Ilo Guided Setup skill from https://example.com/ilo-setup.",
        invocation: "$ilo-setup",
        name: "ilo-setup",
        revision: "release-0.1.0",
        setupPrompt: "Use $ilo-setup to set up Ilo.",
        sourceUrl: "https://example.com/ilo-setup",
        version: "0.1.0",
      },
    });
    mocks.getAssistantSetupStatus.mockResolvedValue({
      domains: [
        {
          approvedProfileStatus: null,
          approvedProfileVersion: null,
          canRead: true,
          canWrite: true,
          domain: "mail",
          pendingDraftVersion: null,
          profileStatus: "active",
          profileVersion: 1,
        },
        {
          approvedProfileStatus: null,
          approvedProfileVersion: null,
          canRead: true,
          canWrite: true,
          domain: "calendar",
          pendingDraftVersion: null,
          profileStatus: null,
          profileVersion: null,
        },
        {
          approvedProfileStatus: "active",
          approvedProfileVersion: 2,
          canRead: true,
          canWrite: true,
          domain: "finances",
          pendingDraftVersion: 3,
          profileStatus: "draft",
          profileVersion: 3,
        },
        {
          approvedProfileStatus: null,
          approvedProfileVersion: null,
          canRead: true,
          canWrite: true,
          domain: "reminders",
          pendingDraftVersion: null,
          profileStatus: "active",
          profileVersion: 4,
        },
      ],
    });
    mocks.listAttentionItems.mockImplementation(async ({ domain }: { domain: string }) =>
      domain === "calendar"
        ? [
            {
              id: "attention-1",
            },
          ]
        : [],
    );
    mocks.listCalendars.mockResolvedValue([
      {
        id: "calendar-1",
        isSelected: true,
        isWritable: true,
        source: { syncStatus: "idle" },
      },
      {
        id: "calendar-2",
        isSelected: false,
        isWritable: false,
        source: { syncStatus: "error" },
      },
    ]);
    mocks.listReminders.mockResolvedValue({
      items: [{ id: "reminder-1" }],
      nextCursor: null,
    });
    mocks.getFinanceGuidedSetup.mockResolvedValue({
      accountSources: [{ id: "finance-1" }, { id: "finance-2" }],
      ledgerHealth: { staleAccounts: 1 },
      reviewSummary: { count: 3 },
      suggestedWorkflows: [{ available: true }, { available: true }, { available: false }],
    });
    mocks.getMailSetupContext.mockResolvedValue({
      accounts: [
        {
          accountId: id,
          automation: {
            failedCount: 0,
            inProgressCount: 0,
            lastCompletedAt: now,
            pendingCount: 1,
            reconciliationCount: 0,
          },
          automaticRuleExecution: true,
          email: "person@example.com",
          label: "Personal",
          lastSyncedAt: now,
          mailboxes: [],
          provider: "google",
          syncError: null,
          syncStatus: "idle",
        },
        {
          accountId: "55555555-5555-4555-8555-555555555555",
          automation: {
            failedCount: 0,
            inProgressCount: 0,
            lastCompletedAt: null,
            pendingCount: 0,
            reconciliationCount: 0,
          },
          automaticRuleExecution: false,
          email: null,
          label: "iCloud",
          lastSyncedAt: null,
          mailboxes: [],
          provider: "icloud",
          syncError: "App-specific password expired",
          syncStatus: "error",
        },
        {
          accountId: "66666666-6666-4666-8666-666666666666",
          automation: {
            failedCount: 0,
            inProgressCount: 0,
            lastCompletedAt: null,
            pendingCount: 0,
            reconciliationCount: 0,
          },
          automaticRuleExecution: true,
          email: "work@example.com",
          label: "Work",
          lastSyncedAt: null,
          mailboxes: [],
          provider: "google",
          syncError: null,
          syncStatus: "idle",
        },
      ],
      automation: {
        executionLimitPerRun: 6,
        failedCount: 0,
        inProgressCount: 0,
        lastCompletedAt: now,
        oldestDueAt: now,
        pendingCount: 1,
        reconciliationCount: 0,
      },
      safety: {
        delayedRetentionAutomation: true,
        permanentDeletion: false,
        providerFilterCreation: false,
        spamClassification: false,
        unsubscribeAutomation: false,
      },
    });
    mocks.listMailRules.mockResolvedValue([
      {
        actions: [{ afterDays: 1, mailboxId: null, type: "trash" }],
        condition: { field: "sender", operator: "ends_with", value: "@orders.example" },
        confidenceThreshold: null,
        createdAt: now,
        description: "",
        domain: "mail",
        enabled: true,
        id,
        name: "Routine orders",
        policy: "approved_rule",
        profileId: null,
        sourceIds: [id],
        updatedAt: now,
        version: 1,
      },
      {
        actions: [{ afterDays: 0, mailboxId: null, type: "mark_read" }],
        condition: { field: "sender", operator: "ends_with", value: "@news.example" },
        confidenceThreshold: null,
        createdAt: now,
        description: "",
        domain: "mail",
        enabled: false,
        id: "33333333-3333-4333-8333-333333333333",
        name: "Old newsletters",
        policy: "preview",
        profileId: id,
        sourceIds: [id],
        updatedAt: now,
        version: 1,
      },
    ]);
    const preview = {
      candidates: [
        {
          accountId: id,
          actions: [{ afterDays: 0, due: true, mailboxId: null, type: "mark_read" }],
          from: { address: "news@news.example", name: "News" },
          id: "44444444-4444-4444-8444-444444444444",
          receivedAt: now,
          subject: "Weekly news",
        },
      ],
      fingerprint: "a".repeat(64),
      matchedCount: 1,
      previewedAt: now,
      ruleId: "33333333-3333-4333-8333-333333333333",
      ruleVersion: 1,
      scannedCount: 10,
      window: {
        limit: 200,
        newestReceivedAt: now,
        oldestReceivedAt: now,
        truncated: false,
      },
    };
    mocks.previewSavedMailRule.mockResolvedValue(preview);
    mocks.activateMailRule.mockResolvedValue({
      preview,
      rule: {
        actions: [{ afterDays: 0, mailboxId: null, type: "mark_read" }],
        condition: { field: "sender", operator: "ends_with", value: "@news.example" },
        confidenceThreshold: null,
        createdAt: now,
        description: "",
        domain: "mail",
        enabled: true,
        id: "33333333-3333-4333-8333-333333333333",
        name: "Old newsletters",
        policy: "approved_rule",
        profileId: id,
        sourceIds: [id],
        updatedAt: now,
        version: 2,
      },
    });
    mocks.listAccessTokens.mockResolvedValue([
      {
        createdAt: now,
        expiresAt: null,
        id,
        lastUsedAt: null,
        name: "Local Codex",
        revokedAt: null,
        scopes: ["mail:read", "mail:write"],
      },
      {
        createdAt: now,
        expiresAt: null,
        id: "22222222-2222-4222-8222-222222222222",
        lastUsedAt: null,
        name: "Old agent",
        revokedAt: now,
        scopes: ["mail:read"],
      },
    ]);
    mocks.listOAuthClients.mockResolvedValue([
      {
        id,
        lastUsedAt: now,
        name: "Claude",
        redirectUris: ["https://claude.example.com/callback"],
        scopes: ["mail:read", "mail:write"],
      },
      {
        id: "77777777-7777-4777-8777-777777777777",
        lastUsedAt: null,
        name: "Codex",
        redirectUris: ["https://codex.example.com/callback"],
        scopes: ["mail:read"],
      },
    ]);
    mocks.createAccessToken.mockResolvedValue({
      createdAt: now,
      expiresAt: null,
      id,
      lastUsedAt: null,
      name: "Local agent",
      revokedAt: null,
      scopes: ["mail:read", "mail:write"],
      token: "pos_once",
    });
    mocks.deleteAccessToken.mockResolvedValue(undefined);
    mocks.revokeOAuthClient.mockResolvedValue(undefined);
  });

  it("connects a host, installs the skill, selects a domain, and manages fallback access", async () => {
    const browser = userEvent.setup();
    renderSettings();

    expect(await screen.findByRole("heading", { name: "Connect an agent" })).toBeInTheDocument();
    expect(await screen.findByText("3 connected")).toBeInTheDocument();
    expect(await screen.findByText(/1 active approved Mail rule · profile v1/)).toBeInTheDocument();
    expect(
      screen.getByText(
        "3 connected hosts can read Mail; 2 can manage Mail through scoped actions.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Ilo Guided Setup v0.1.0")).toBeInTheDocument();
    expect(screen.getByText(/Source revision release-0.1.0/)).toBeInTheDocument();
    expect(await screen.findByText(/Oldest due:/)).toBeInTheDocument();
    expect(await screen.findByText(/Last completed:/)).toBeInTheDocument();
    expect(
      await screen.findByText(
        /3 Mail accounts · person@example.com, iCloud \+1 · 1 needs reconnect/,
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Not used yet/)).toHaveLength(2);
    await browser.click(screen.getByRole("button", { name: "Review" }));
    expect(await screen.findByText("Weekly news")).toBeInTheDocument();
    expect(screen.getByText(/Rule scope: person@example.com/)).toBeInTheDocument();
    expect(screen.getByText(/mark read — due now/)).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Activate reviewed rule" }));
    await waitFor(() =>
      expect(mocks.activateMailRule).toHaveBeenCalledWith("33333333-3333-4333-8333-333333333333", {
        expectedCandidateIds: ["44444444-4444-4444-8444-444444444444"],
        expectedPreviewFingerprint: "a".repeat(64),
        expectedPreviewedAt: now,
        expectedVersion: 1,
      }),
    );
    await waitFor(() => expect(mocks.getMailSetupContext).toHaveBeenCalledTimes(2));

    await browser.click(screen.getByRole("button", { name: "Copy Ilo MCP URL" }));
    await expect(navigator.clipboard.readText()).resolves.toBe("https://mcp.example.com/mcp");
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("Clipboard denied"));
    await browser.click(screen.getByRole("button", { name: "Copy skill install request" }));
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("Could not copy skill install request."),
    );

    await browser.click(screen.getByRole("radio", { name: "Calendar" }));
    expect(screen.getByText("Calendar preferences and commitment previews")).toBeInTheDocument();
    expect(
      await screen.findByText(/2 calendars · 1 selected · 1 writable · 1 needs reconnect/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/1 writable destination.*automatic creation is not enabled/),
    ).toBeInTheDocument();
    expect(screen.getByText("1 open Calendar attention item.")).toBeInTheDocument();
    expect(screen.getByText("No connected host has Calendar read permission.")).toBeInTheDocument();
    expect(screen.getByLabelText<HTMLTextAreaElement>("Calendar setup prompt").value).toContain(
      "set up my Calendar",
    );

    await browser.click(screen.getByRole("radio", { name: "Reminders" }));
    expect(await screen.findByText("1 open Reminder in Ilo.")).toBeInTheDocument();
    expect(
      screen.getByText(/Ilo supports bounded single-item Reminder actions/),
    ).toBeInTheDocument();
    expect(screen.getByText("Profile v4 is active.")).toBeInTheDocument();
    expect(
      screen.getByText("No connected host has Reminders read permission."),
    ).toBeInTheDocument();

    await browser.click(screen.getByRole("radio", { name: "Finances" }));
    expect(await screen.findByText("2 Finance accounts · 1 stale")).toBeInTheDocument();
    expect(
      screen.getByText(/2 guidance or review workflows available · 3 items need signed-in review/),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/Active approved guidance is version 2, with draft version 3/),
    ).toBeInTheDocument();
    expect(screen.getByText("No connected host has Finances read permission.")).toBeInTheDocument();

    await browser.click(screen.getByRole("button", { name: "Revoke Claude" }));
    await waitFor(() => expect(mocks.revokeOAuthClient.mock.calls[0]?.[0]).toBe(id));

    await browser.click(screen.getByRole("button", { name: "Set up a local token" }));
    await browser.click(screen.getByRole("radio", { name: /Full Ilo/ }));
    await browser.click(screen.getByText(/Fine-tune permissions/));
    await browser.click(screen.getByLabelText("Read X bookmarks"));
    await browser.click(screen.getByLabelText("Read X bookmarks"));
    await browser.click(screen.getByRole("button", { name: "Create local token" }));
    await waitFor(() =>
      expect(mocks.createAccessToken).toHaveBeenCalledWith(
        expect.objectContaining({
          scopes: expect.arrayContaining(["finances:read", "finances:write", "mail:write"]),
        }),
      ),
    );
    expect(await screen.findByText("pos_once")).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Dismiss token" }));
    await browser.click(screen.getByRole("button", { name: "Revoke Local Codex" }));
    await waitFor(() => expect(mocks.deleteAccessToken.mock.calls[0]?.[0]).toBe(id));
    await browser.click(screen.getByRole("button", { name: "Revoked tokens · 1" }));
    expect(screen.getByText("Old agent")).toBeInTheDocument();
  });

  it("allows reviewed one-day recoverable Trash rules to activate durably", async () => {
    const browser = userEvent.setup();
    const ruleId = "33333333-3333-4333-8333-333333333333";
    mocks.listMailRules.mockResolvedValue([
      {
        actions: [{ afterDays: 1, mailboxId: null, type: "trash" }],
        condition: { field: "sender", operator: "ends_with", value: "@orders.example" },
        confidenceThreshold: null,
        createdAt: now,
        description: "Keep routine orders for one day.",
        domain: "mail",
        enabled: false,
        id: ruleId,
        name: "One-day order retention",
        policy: "preview",
        profileId: id,
        sourceIds: [],
        updatedAt: now,
        version: 1,
      },
    ]);
    mocks.previewSavedMailRule.mockResolvedValue({
      candidates: [
        {
          accountId: "88888888-8888-4888-8888-888888888888",
          actions: [{ afterDays: 1, due: false, mailboxId: null, type: "trash" }],
          from: { address: "orders@orders.example", name: "Orders" },
          id: "44444444-4444-4444-8444-444444444444",
          receivedAt: now,
          subject: "",
        },
        {
          accountId: id,
          actions: [{ afterDays: 1, due: true, mailboxId: null, type: "trash" }],
          from: { address: "second@orders.example", name: null },
          id: "99999999-9999-4999-8999-999999999999",
          receivedAt: now,
          subject: "Second order",
        },
      ],
      fingerprint: "b".repeat(64),
      matchedCount: 2,
      previewedAt: now,
      ruleId,
      ruleVersion: 1,
      scannedCount: 10,
      window: {
        limit: 200,
        newestReceivedAt: now,
        oldestReceivedAt: now,
        truncated: true,
      },
    });
    renderSettings();
    await browser.click(await screen.findByRole("button", { name: "Review" }));
    expect(screen.getByText("(No subject)")).toBeInTheDocument();
    expect(screen.getByText(/Unknown account/)).toBeInTheDocument();
    expect(screen.getByText(/Rule scope: no explicit account selected/)).toBeInTheDocument();
    expect(screen.getByText(/more than 200 exist/)).toBeInTheDocument();
    expect(screen.getByText(/recoverable Trash after 1d — retained until due/)).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Activate reviewed rule" }));
    await waitFor(() =>
      expect(mocks.activateMailRule).toHaveBeenCalledWith(ruleId, {
        expectedCandidateIds: [
          "44444444-4444-4444-8444-444444444444",
          "99999999-9999-4999-8999-999999999999",
        ],
        expectedPreviewFingerprint: "b".repeat(64),
        expectedPreviewedAt: now,
        expectedVersion: 1,
      }),
    );
  });

  it("keeps missing sources and connection-guide failures actionable", async () => {
    mocks.getAgentConnectionGuide.mockRejectedValue(new Error("Connection guide unavailable"));
    mocks.getAssistantSetupStatus.mockResolvedValue({
      domains: [
        {
          approvedProfileStatus: null,
          approvedProfileVersion: null,
          canRead: true,
          canWrite: true,
          domain: "mail",
          pendingDraftVersion: null,
          profileStatus: "draft",
          profileVersion: 1,
        },
      ],
    });
    mocks.getMailSetupContext.mockResolvedValue({
      accounts: [],
      automation: {
        executionLimitPerRun: 6,
        failedCount: 0,
        inProgressCount: 0,
        lastCompletedAt: null,
        oldestDueAt: null,
        pendingCount: 0,
        reconciliationCount: 0,
      },
      safety: {
        delayedRetentionAutomation: true,
        permanentDeletion: false,
        providerFilterCreation: false,
        spamClassification: false,
        unsubscribeAutomation: false,
      },
    });
    mocks.listMailRules.mockResolvedValue([]);
    mocks.listAccessTokens.mockResolvedValue([]);
    mocks.listOAuthClients.mockResolvedValue([]);
    renderSettings();

    expect(await screen.findByText("Connection guide unavailable")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Mail" })).toBeDisabled();
    expect(screen.getByText("Mail readiness unavailable")).toBeInTheDocument();
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy Mail setup prompt" })).toBeDisabled();
  });

  it("keeps empty core domains truthful without inventing connected material", async () => {
    const browser = userEvent.setup();
    mocks.getAssistantSetupStatus.mockResolvedValue({
      domains: [
        {
          approvedProfileStatus: null,
          approvedProfileVersion: null,
          canRead: true,
          canWrite: true,
          domain: "calendar",
          pendingDraftVersion: null,
          profileStatus: null,
          profileVersion: null,
        },
        {
          approvedProfileStatus: null,
          approvedProfileVersion: null,
          canRead: true,
          canWrite: false,
          domain: "reminders",
          pendingDraftVersion: null,
          profileStatus: null,
          profileVersion: null,
        },
        {
          approvedProfileStatus: null,
          approvedProfileVersion: null,
          canRead: true,
          canWrite: true,
          domain: "finances",
          pendingDraftVersion: null,
          profileStatus: null,
          profileVersion: null,
        },
      ],
    });
    mocks.listCalendars.mockResolvedValue([]);
    mocks.listReminders.mockResolvedValue({ items: [], nextCursor: null });
    mocks.getFinanceGuidedSetup.mockResolvedValue({
      accountSources: [],
      ledgerHealth: { staleAccounts: 0 },
      reviewSummary: { count: 0 },
      suggestedWorkflows: [{ available: false }],
    });
    mocks.listAttentionItems.mockImplementation(async ({ domain }: { domain: string }) =>
      domain === "finances"
        ? Array.from({ length: 100 }, (_, index) => ({ id: `attention-${index}` }))
        : [],
    );
    renderSettings();

    await browser.click(screen.getByRole("radio", { name: "Calendar" }));
    expect(await screen.findByRole("link", { name: "Open Calendar" })).toBeInTheDocument();
    expect(
      screen.getByText("A selected writable calendar is required for commitment previews."),
    ).toBeInTheDocument();

    await browser.click(screen.getByRole("radio", { name: "Reminders" }));
    expect(await screen.findByRole("link", { name: "Open Reminders" })).toBeInTheDocument();
    expect(
      screen.getByText("No open Reminders. Local capture is available whenever you need it."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No connected host has Reminders read permission."),
    ).toBeInTheDocument();

    await browser.click(screen.getByRole("radio", { name: "Finances" }));
    expect(await screen.findByRole("link", { name: "Open Finances" })).toBeInTheDocument();
    expect(screen.getByText("0 Finance accounts")).toBeInTheDocument();
    expect(
      screen.getByText("0 guidance or review workflows available · 0 items need signed-in review."),
    ).toBeInTheDocument();
    expect(screen.getByText("100+ open Finances attention items.")).toBeInTheDocument();
  });

  it("isolates a selected-domain readiness failure from the connection handoff", async () => {
    const browser = userEvent.setup();
    mocks.listCalendars.mockRejectedValue(new Error("Calendar readiness unavailable"));
    renderSettings();

    await browser.click(screen.getByRole("radio", { name: "Calendar" }));
    expect(await screen.findByText("Calendar readiness unavailable")).toBeInTheDocument();
    expect(screen.getByLabelText("Ilo MCP URL")).toHaveValue("https://mcp.example.com/mcp");
    expect(screen.getByRole("button", { name: "Copy skill install request" })).toBeEnabled();
  });

  it("keeps pending and failed readiness distinct from a successful empty result", async () => {
    mocks.getAssistantSetupStatus.mockReturnValue(new Promise(() => {}));
    renderSettings();
    expect(await screen.findByText("Mail preferences are loading.")).toBeInTheDocument();
  });

  it("does not turn failed rules or setup status into zero and absent claims", async () => {
    mocks.listMailRules.mockRejectedValue(new Error("Mail rules unavailable"));
    renderSettings();
    expect(await screen.findByText("Mail rules unavailable")).toBeInTheDocument();
    expect(
      screen.getByText("Mail rules are unavailable, so Ilo cannot report an approved-rule count."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/0 active approved Mail rules/)).not.toBeInTheDocument();
  });

  it("reports unavailable profile state when setup status fails", async () => {
    mocks.getAssistantSetupStatus.mockRejectedValue(new Error("Setup status unavailable"));
    renderSettings();
    expect(await screen.findByText("Setup status unavailable")).toBeInTheDocument();
    expect(
      await screen.findByText("Mail preferences are unavailable until setup status can be loaded."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Run the guided interview/)).not.toBeInTheDocument();
  });

  it("disables missing guide support and keeps future Calendar rules domain-owned", async () => {
    const browser = userEvent.setup();
    const guide = await mocks.getAgentConnectionGuide();
    mocks.getAgentConnectionGuide.mockResolvedValue({
      ...guide,
      domains: guide.domains
        .filter((item: { domain: string }) => item.domain !== "reminders")
        .map((item: { domain: string; support: string }) =>
          item.domain === "calendar" ? { ...item, support: "executable_rules" } : item,
        ),
    });
    renderSettings();

    expect(await screen.findByRole("radio", { name: "Reminders" })).toBeDisabled();
    await browser.click(screen.getByRole("radio", { name: "Calendar" }));
    expect(screen.getByText("Calendar profiles, previews, and rules")).toBeInTheDocument();
    expect(screen.getByText(/Calendar-owned executable rules/)).toBeInTheDocument();
    expect(screen.queryByText(/inbox|recoverable Trash/)).not.toBeInTheDocument();
  });

  it("explains an empty rule sample while an inactive profile blocks activation", async () => {
    const browser = userEvent.setup();
    const ruleId = "33333333-3333-4333-8333-333333333333";
    mocks.getAssistantSetupStatus.mockResolvedValue({
      domains: [
        {
          approvedProfileStatus: null,
          approvedProfileVersion: null,
          canRead: true,
          canWrite: true,
          domain: "mail",
          pendingDraftVersion: null,
          profileStatus: "draft",
          profileVersion: 2,
        },
      ],
    });
    mocks.listMailRules.mockResolvedValue([
      {
        actions: [{ afterDays: 0, mailboxId: null, type: "mark_read" }],
        condition: { field: "subject", operator: "contains", value: "receipts" },
        confidenceThreshold: null,
        createdAt: now,
        description: "Mark routine receipts read.",
        domain: "mail",
        enabled: false,
        id: ruleId,
        name: "Routine receipts",
        policy: "preview",
        profileId: id,
        sourceIds: ["88888888-8888-4888-8888-888888888888"],
        updatedAt: now,
        version: 2,
      },
    ]);
    mocks.previewSavedMailRule.mockResolvedValue({
      candidates: [],
      fingerprint: "c".repeat(64),
      matchedCount: 0,
      previewedAt: now,
      ruleId,
      ruleVersion: null,
      scannedCount: 0,
      window: {
        limit: 200,
        newestReceivedAt: null,
        oldestReceivedAt: null,
        truncated: false,
      },
    });
    renderSettings();

    await browser.click(await screen.findByRole("button", { name: "Review" }));
    expect(await screen.findByText(/Reviewed 0 of 200 recent conversations/)).toBeInTheDocument();
    expect(screen.getByText(/Rule scope: Unknown account/)).toBeInTheDocument();
    expect(screen.getByText("Activate your Mail profile first")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activate reviewed rule" })).toBeDisabled();
  });
});
