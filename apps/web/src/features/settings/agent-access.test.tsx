// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import {
  ConnectedAgentsSettings,
  WorkspaceAccessSettings,
  WorkspaceSettings,
} from "./agent-access.js";

const id = "11111111-1111-4111-8111-111111111111";
const now = "2026-07-28T12:00:00.000Z";

const mocks = vi.hoisted(() => ({
  activateMailRule: vi.fn(),
  createAccessToken: vi.fn(),
  deleteAccessToken: vi.fn(),
  getAgentConnectionGuide: vi.fn(),
  getAssistantSetupStatus: vi.fn(),
  getIloSetup: vi.fn(),
  getFinanceGuidedSetup: vi.fn(),
  getMailSetupContext: vi.fn(),
  listAccessTokens: vi.fn(),
  listAgentAccessWorkItems: vi.fn(),
  listAttentionItems: vi.fn(),
  listCalendars: vi.fn(),
  listMailRules: vi.fn(),
  listOAuthClients: vi.fn(),
  listTasks: vi.fn(),
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

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Current location">{`${location.pathname}${location.search}`}</output>;
}

function SettingsDestination() {
  const location = useLocation();
  const section = new URLSearchParams(location.search).get("section");
  if (section === "agent-connections") return <ConnectedAgentsSettings />;
  if (section === "workspace-access") return <WorkspaceAccessSettings />;
  if (
    section === "finances" ||
    section === "mail" ||
    section === "calendar" ||
    section === "tasks"
  ) {
    return <WorkspaceSettings domain={section} />;
  }
  return <WorkspaceAccessSettings />;
}

function renderSettings(initialEntry = "/settings?section=workspace-access") {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <SettingsDestination />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function readinessOverview(label: string) {
  const panel = screen.getByText(`${label} readiness`).closest('[data-slot="item"]');
  if (!(panel instanceof HTMLElement)) {
    throw new Error(`${label} readiness overview was not rendered.`);
  }
  return within(panel);
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
        displayName: "nohmi Guided Setup",
        installPrompt:
          "Install the ilo-setup skill from https://app.example.com/skills/ilo-setup/v0.2.0/SKILL.md.",
        invocation: "$ilo-setup",
        name: "ilo-setup",
        revision: "v0.2.0",
        setupPrompt: "Use $ilo-setup to set up nohmi.",
        sourceUrl: "https://app.example.com/skills/ilo-setup/v0.2.0/SKILL.md",
        version: "0.2.0",
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
          domain: "tasks",
          pendingDraftVersion: null,
          profileStatus: "active",
          profileVersion: 4,
        },
      ],
    });
    mocks.getIloSetup.mockImplementation(async ({ domain }: { domain?: string } = {}) => {
      const selectedDomain = domain ?? "mail";
      const active = selectedDomain === "mail" || selectedDomain === "tasks";
      const draft = selectedDomain === "finances";
      const currentStepId = active ? "complete" : draft ? "review_guidance" : "learn_preferences";
      const stepState = (id: string) => {
        if (id === "connect_agent") return "complete";
        if (id === "learn_preferences") return active || draft ? "complete" : "current";
        if (id === "review_guidance") return active ? "complete" : draft ? "current" : "blocked";
        return active ? "complete" : "blocked";
      };
      return {
        access: { canRead: true, canWrite: true },
        connection: { lastObservedAt: now, observed: true },
        currentStepId,
        domain: selectedDomain,
        nextAction: active
          ? `${selectedDomain} setup is active.`
          : draft
            ? `Review ${selectedDomain} draft version 3 and accept or revise it.`
            : `The agent should inspect ${selectedDomain} material and save a draft profile.`,
        profile: {
          approvedStatus: draft ? "active" : null,
          approvedVersion: draft ? 2 : null,
          pendingDraftVersion: draft ? 3 : null,
          status: active ? "active" : draft ? "draft" : null,
          version: active ? 1 : draft ? 3 : null,
        },
        progress: { completed: active ? 4 : draft ? 2 : 1, total: 4 },
        protocolVersion: "1.0",
        selectedStepId: currentStepId,
        status: active ? "complete" : draft ? "needs_input" : "in_progress",
        steps: [
          {
            completionEvidence: ["This authenticated MCP caller reached nohmi."],
            description: "Authorize one MCP host.",
            id: "connect_agent",
            instructions: [],
            order: 1,
            owner: "person",
            requiredTools: [],
            state: stepState("connect_agent"),
            title: "Connect an agent",
            userAction: null,
          },
          {
            completionEvidence: active || draft ? ["Guidance exists at profile version 1."] : [],
            description:
              "Inspect existing nohmi material and ask only about unresolved preferences.",
            id: "learn_preferences",
            instructions: [],
            order: 2,
            owner: "agent",
            requiredTools: ["get_domain_profile"],
            state: stepState("learn_preferences"),
            title: `Learn ${selectedDomain} preferences`,
            userAction: null,
          },
          {
            completionEvidence: active ? ["Guidance is active."] : [],
            description: "Show what the guidance covers and preserve approval.",
            id: "review_guidance",
            instructions: [],
            order: 3,
            owner: "person",
            requiredTools: [],
            state: stepState("review_guidance"),
            title: "Review the proposed guidance",
            userAction: null,
          },
          {
            completionEvidence: active ? ["Setup is confirmed."] : [],
            description: "nohmi confirms setup.",
            id: "complete",
            instructions: [],
            order: 4,
            owner: "ilo",
            requiredTools: ["get_ilo_setup"],
            state: stepState("complete"),
            title: "Confirm setup",
            userAction: null,
          },
        ],
      };
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
    mocks.listTasks.mockResolvedValue({
      items: [{ id: "task-1" }],
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
      commitmentIntake: {
        automaticCreationEnabled: false,
        previewOnlyCount: 2,
        serverVerifiedCount: 0,
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
        scopes: ["mail:read", "mail:write", "automations:write"],
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
      {
        createdAt: now,
        expiresAt: "2099-08-12T12:00:00.000Z",
        id: "88888888-8888-4888-8888-888888888888",
        lastUsedAt: null,
        name: "Future agent",
        revokedAt: null,
        scopes: ["mail:read"],
      },
      {
        createdAt: now,
        expiresAt: "2020-08-12T12:00:00.000Z",
        id: "99999999-9999-4999-8999-999999999999",
        lastUsedAt: null,
        name: "Expired agent",
        revokedAt: null,
        scopes: ["automations:write"],
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
    mocks.listAgentAccessWorkItems.mockResolvedValue({
      filteredTotal: 0,
      items: [],
      nextCursor: null,
      snapshotAt: now,
      summary: {
        byDomain: { calendar: 0, finances: 0, mail: 0, tasks: 0 },
        byKind: { attention: 0, review: 0 },
        total: 0,
      },
      unavailableDomains: [],
    });
  });

  it("keeps workspace access limited to agent authority and separates connected agents", async () => {
    const browser = userEvent.setup();
    renderSettings("/settings?section=workspace-access&workspace=mail");

    expect(await screen.findByRole("heading", { name: "Workspace access" })).toBeInTheDocument();
    expect(screen.queryByText("Your action queue")).not.toBeInTheDocument();
    expect(screen.queryByText("Access management")).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Mail" })).toBeChecked();
    expect(screen.queryByText("Calendar readiness")).not.toBeInTheDocument();
    await screen.findByRole("heading", { name: "Mail profiles, previews, and approved rules" });
    expect(
      screen.queryByRole("button", { name: /Let the agent set up nohmi/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Mail" })).not.toHaveTextContent("Not set up");

    const allowed = screen.getByRole("heading", { name: "Allowed" });
    const approvalRequired = screen.getByRole("heading", { name: "Needs your approval" });
    const notAllowed = screen.getByRole("heading", { name: "Not allowed" });
    expect(allowed.querySelector("svg")).not.toBeInTheDocument();
    expect(approvalRequired.querySelector("svg")).not.toBeInTheDocument();
    expect(notAllowed.querySelector("svg")).not.toBeInTheDocument();
    expect(
      allowed.parentElement?.querySelectorAll('li svg[data-tier="allowed"]').length ?? 0,
    ).toBeGreaterThan(0);
    expect(
      approvalRequired.parentElement?.querySelectorAll('li svg[data-tier="approval-required"]')
        .length ?? 0,
    ).toBeGreaterThan(0);
    expect(
      notAllowed.parentElement?.querySelectorAll('li svg[data-tier="not-allowed"]').length ?? 0,
    ).toBeGreaterThan(0);

    await browser.click(screen.getByRole("radio", { name: "Tasks" }));
    expect(screen.getByLabelText("Current location")).toHaveTextContent(
      "/settings?section=workspace-access&workspace=tasks",
    );
    await browser.click(screen.getByRole("link", { name: "Connected agents" }));
    expect(await screen.findByRole("heading", { name: "Connected agents" })).toBeInTheDocument();
    expect(screen.getByLabelText("nohmi MCP URL")).toHaveValue("https://mcp.example.com/mcp");
  });

  it("shows one person-owned action without repeating setup or operational review state", async () => {
    const finance = renderSettings("/settings?section=finances");

    expect(await screen.findByRole("heading", { name: "Finances settings" })).toBeInTheDocument();
    expect(await screen.findAllByText("Action required")).toHaveLength(1);
    expect(
      screen.getByText("Review finances draft version 3 and accept or revise it."),
    ).toBeInTheDocument();
    expect(screen.getByText("Finances readiness")).toBeInTheDocument();
    expect(screen.queryByText("Next step:")).not.toBeInTheDocument();
    expect(screen.queryByText("Operational review")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Review 3 Finance items" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Finish Finances setup/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Connect an agent")).not.toBeInTheDocument();
    expect(screen.queryByText("Confirm setup")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Setup protocol details" })).toBeInTheDocument();

    finance.unmount();
    renderSettings("/settings?section=mail");
    expect(await screen.findByRole("heading", { name: "Mail settings" })).toBeInTheDocument();
    expect(screen.queryByText("No settings action needed")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Setup protocol details" }),
    ).not.toBeInTheDocument();
  });

  it("reports unavailable connection inventory without inventing a count", async () => {
    mocks.listAccessTokens.mockRejectedValueOnce(new Error("Token inventory unavailable"));
    renderSettings("/settings?section=agent-connections");

    expect(await screen.findByText("Connections unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/\d+ connected/)).not.toBeInTheDocument();
  });

  it("keeps failed access changes visible and reports their errors", async () => {
    const browser = userEvent.setup();
    mocks.revokeOAuthClient.mockRejectedValueOnce(new Error("Could not revoke host"));
    mocks.createAccessToken.mockRejectedValueOnce(new Error("Could not create token"));
    renderSettings("/settings?section=agent-connections");

    await browser.click(await screen.findByRole("button", { name: "Revoke Claude" }));
    await browser.click(screen.getByRole("button", { name: "Revoke access" }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("Could not revoke host"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Cancel" }));

    await browser.click(screen.getByRole("button", { name: "Set up a local token" }));
    await browser.click(screen.getByRole("button", { name: "Create local token" }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("Could not create token"));
    expect(screen.queryByText("Copy this token now")).not.toBeInTheDocument();
  });

  it("connects a host, shows agent-owned setup progress, selects a domain, and manages fallback access", async () => {
    const browser = userEvent.setup();
    renderSettings("/settings?section=mail&reviewRule=33333333-3333-4333-8333-333333333333");

    expect(await screen.findByRole("heading", { name: "Mail settings" })).toBeInTheDocument();
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
    expect(screen.getByLabelText("Current location")).toHaveTextContent("/settings?section=mail");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByText("Routine orders")).not.toBeInTheDocument();
    expect(await screen.findByText("Mail readiness")).toBeInTheDocument();
    expect(await screen.findByText("4 of 5 complete")).toBeInTheDocument();
    expect(screen.getByText("1 to finish")).toBeInTheDocument();
    expect(screen.getByText("Current constraint:").closest("p")).toHaveTextContent(
      "Current constraint: Calendar attachments",
    );
    expect(screen.queryByRole("list", { name: "Mail readiness checks" })).not.toBeInTheDocument();
    const readinessDisclosure = screen.getByRole("button", { name: "Review checks" });
    readinessDisclosure.focus();
    await browser.keyboard("{Enter}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    const mailChecks = within(screen.getByRole("dialog"));
    expect(
      mailChecks.getByRole("list", { name: "Mail readiness checks: not ready" }),
    ).toBeInTheDocument();
    expect(
      mailChecks.getByText("Automatic calendar creation is off · 2 candidates waiting"),
    ).toBeInTheDocument();
    await browser.click(mailChecks.getByRole("button", { name: "Show 4 completed checks" }));
    expect(mailChecks.getByText("Accounts")).toBeInTheDocument();
    expect(mailChecks.getByText("Rules")).toBeInTheDocument();
    expect(mailChecks.getByText("Scheduled actions")).toBeInTheDocument();
    expect(mailChecks.getByText("Agent access")).toBeInTheDocument();
    expect(mailChecks.getByText("Profile v1 · 1 approved rule active")).toBeInTheDocument();
    expect(
      mailChecks.getByText("2 agents can read Mail · 1 can manage Mail through scoped actions"),
    ).toBeInTheDocument();
    expect(
      mailChecks.getByText(/3 connected · person@example.com, iCloud \+1 · 1 needs reconnect/),
    ).toBeInTheDocument();
    await browser.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("No settings action needed")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Setup protocol details" }),
    ).not.toBeInTheDocument();

    await browser.click(screen.getByRole("link", { name: "Workspace access" }));
    await browser.click(screen.getByRole("link", { name: "Connected agents" }));
    expect(await screen.findByText("2 connected")).toBeInTheDocument();
    expect(screen.getByText(/Legacy inactive permission/)).toBeInTheDocument();
    const claudeHost = (await screen.findByText("Claude")).closest('[data-slot="item"]');
    expect(claudeHost?.querySelector('[data-slot="item-media"] svg.reicon')).not.toBeNull();
    await browser.click(screen.getByRole("button", { name: "Copy nohmi MCP URL" }));
    await expect(navigator.clipboard.readText()).resolves.toBe("https://mcp.example.com/mcp");

    await browser.click(screen.getByRole("button", { name: "Revoke Claude" }));
    await browser.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    let resolveRevoke!: () => void;
    mocks.revokeOAuthClient.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveRevoke = resolve;
        }),
    );
    await browser.click(screen.getByRole("button", { name: "Revoke Claude" }));
    await browser.click(screen.getByRole("button", { name: "Revoke access" }));
    expect(screen.getByRole("button", { name: "Revoking…" })).toBeDisabled();
    resolveRevoke();
    await waitFor(() => expect(mocks.revokeOAuthClient.mock.calls[0]?.[0]).toBe(id));

    await browser.click(screen.getByRole("button", { name: "Set up a local token" }));
    await browser.click(screen.getByRole("radio", { name: /Full nohmi/ }));
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
    expect(mocks.createAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ scopes: expect.arrayContaining(["finances:maintain"]) }),
    );
    expect(await screen.findByText("pos_once")).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Dismiss token" }));
    await browser.click(screen.getByRole("button", { name: "Revoke Local Codex" }));
    await browser.click(screen.getByRole("button", { name: "Revoke access" }));
    await waitFor(() => expect(mocks.deleteAccessToken.mock.calls[0]?.[0]).toBe(id));
    await browser.click(screen.getByRole("button", { name: "Inactive tokens · 2" }));
    expect(screen.getByText("Old agent")).toBeInTheDocument();
    expect(screen.getByText("Expired agent")).toBeInTheDocument();
    expect(screen.getByText("Expired · Legacy inactive permission")).toBeInTheDocument();
  }, 15_000);

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
    renderSettings(`/settings?section=mail&reviewRule=${ruleId}`);
    expect(await screen.findByText("(No subject)")).toBeInTheDocument();
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

  it("reports agent-owned setup work without presenting a person action", async () => {
    renderSettings("/settings?section=calendar");

    expect(await screen.findByText("Setup in progress")).toBeVisible();
    expect(screen.getByText(/agent should inspect calendar material/i)).toBeVisible();
    expect(screen.queryByRole("link", { name: "Connect agent" })).not.toBeInTheDocument();
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
      commitmentIntake: {
        automaticCreationEnabled: false,
        previewOnlyCount: 0,
        serverVerifiedCount: 0,
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
    renderSettings("/settings?section=mail");

    expect(await screen.findByText("Connection guide unavailable")).toBeInTheDocument();
    expect(screen.getByText("Mail readiness")).toBeInTheDocument();
    expect(readinessOverview("Mail").getByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByText("Mail is not available in this deployment.")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Copy agent setup request" }),
    ).not.toBeInTheDocument();
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
          domain: "tasks",
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
    mocks.listTasks.mockResolvedValue({ items: [], nextCursor: null });
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
    let view = renderSettings("/settings?section=calendar");

    expect(await screen.findByText("Calendar readiness")).toBeInTheDocument();
    expect((await screen.findByText("Next step:")).closest("p")).toHaveTextContent(
      "Next step: Select a calendar for nohmi to use",
    );
    await browser.click(await screen.findByRole("button", { name: "Review checks" }));
    expect(screen.getByRole("link", { name: "Open Calendar" })).toBeInTheDocument();
    expect(
      screen.getByText("A selected writable calendar is required for commitment previews."),
    ).toBeInTheDocument();
    await browser.keyboard("{Escape}");

    view.unmount();
    view = renderSettings("/settings?section=tasks");
    expect(await screen.findByText("Tasks readiness")).toBeInTheDocument();
    expect((await screen.findByText("Next step:")).closest("p")).toHaveTextContent(
      "Next step: Teach nohmi your Tasks preferences",
    );
    await browser.click(await screen.findByRole("button", { name: "Review checks" }));
    await browser.click(screen.getByRole("button", { name: /Show \d+ completed checks?/ }));
    expect(screen.getByText("Tasks")).toBeInTheDocument();
    expect(
      screen.getByText("No open Tasks. Local capture is available whenever you need it."),
    ).toBeInTheDocument();
    expect(screen.getByText("No connected agent can read Tasks.")).toBeInTheDocument();
    await browser.keyboard("{Escape}");

    view.unmount();
    renderSettings("/settings?section=finances");
    expect(await screen.findByText("Finances readiness")).toBeInTheDocument();
    expect(screen.queryByText("Next step:")).not.toBeInTheDocument();
    await browser.click(await screen.findByRole("button", { name: "Review checks" }));
    const financeChecks = within(screen.getByRole("dialog"));
    expect(financeChecks.getByRole("link", { name: "Open Finances" })).toBeInTheDocument();
    expect(financeChecks.getByText("0 Finance accounts")).toBeInTheDocument();
    expect(financeChecks.queryByText(/attention items/)).not.toBeInTheDocument();
    expect(mocks.listAttentionItems).not.toHaveBeenCalled();
  }, 10_000);

  it("isolates a selected-domain readiness failure from agent connection management", async () => {
    const browser = userEvent.setup();
    mocks.listCalendars.mockRejectedValue(new Error("Calendar readiness unavailable"));
    renderSettings("/settings?section=calendar");

    expect(await screen.findByText("Calendar readiness could not be loaded.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Workspace access" })).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Setup protocol details" }));
    expect(screen.getByRole("button", { name: "Copy agent setup request" })).toBeEnabled();
  });

  it("keeps pending and failed readiness distinct from a successful empty result", async () => {
    mocks.getAssistantSetupStatus.mockReturnValue(new Promise(() => {}));
    renderSettings("/settings?section=mail");
    expect(await screen.findByText("Mail readiness")).toBeInTheDocument();
    expect(screen.getByText("Checking settings")).toBeInTheDocument();
    expect(readinessOverview("Mail").getByText("Checking")).toBeInTheDocument();
    expect(screen.getByText("Checking setup and access.")).toBeInTheDocument();
  });

  it("does not turn failed rules or setup status into zero and absent claims", async () => {
    const browser = userEvent.setup();
    mocks.listMailRules.mockRejectedValue(new Error("Mail rules unavailable"));
    renderSettings("/settings?section=mail");
    expect(await screen.findByText("Mail readiness could not be loaded.")).toBeInTheDocument();
    expect(readinessOverview("Mail").getByText("Unavailable")).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Review checks" }));
    expect(
      screen.getByText("Mail rules are unavailable, so nohmi cannot report an approved-rule count."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/0 active approved Mail rules/)).not.toBeInTheDocument();
  });

  it("reports unavailable profile state when setup status fails", async () => {
    const browser = userEvent.setup();
    mocks.getAssistantSetupStatus.mockRejectedValue(new Error("Setup status unavailable"));
    renderSettings("/settings?section=mail");
    expect(await screen.findByText("Mail readiness could not be loaded.")).toBeInTheDocument();
    expect(readinessOverview("Mail").getByText("Unavailable")).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Review checks" }));
    expect(await screen.findByText("Mail preferences are unavailable.")).toBeInTheDocument();
    expect(screen.queryByText(/Run the guided interview/)).not.toBeInTheDocument();
  });

  it("disables missing guide support and keeps future Calendar rules domain-owned", async () => {
    const browser = userEvent.setup();
    const guide = await mocks.getAgentConnectionGuide();
    mocks.getAgentConnectionGuide.mockResolvedValue({
      ...guide,
      domains: guide.domains
        .filter((item: { domain: string }) => item.domain !== "tasks")
        .map((item: { domain: string; support: string }) =>
          item.domain === "calendar" ? { ...item, support: "executable_rules" } : item,
        ),
    });
    renderSettings();

    expect(await screen.findByRole("radio", { name: "Tasks" })).toBeDisabled();
    await browser.click(screen.getByRole("radio", { name: "Calendar" }));
    expect(await screen.findByText("Calendar profiles, previews, and rules")).toBeInTheDocument();
    expect(screen.getAllByText(/Calendar-owned executable rules/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/inbox|recoverable Trash/)).not.toBeInTheDocument();
  });

  it("explains an empty rule sample while an inactive profile blocks activation", async () => {
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
    renderSettings(`/settings?section=mail&reviewRule=${ruleId}`);
    expect(await screen.findByText(/Reviewed 0 of 200 recent conversations/)).toBeInTheDocument();
    expect(screen.getByText(/Rule scope: Unknown account/)).toBeInTheDocument();
    expect(screen.getByText("Activate your Mail profile first")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activate reviewed rule" })).toBeDisabled();
  });
});
