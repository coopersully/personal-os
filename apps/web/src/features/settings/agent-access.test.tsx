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
  createAccessToken: vi.fn(),
  deleteAccessToken: vi.fn(),
  getAgentConnectionGuide: vi.fn(),
  getAssistantSetupStatus: vi.fn(),
  listAccessTokens: vi.fn(),
  listConnectors: vi.fn(),
  listMailRules: vi.fn(),
  listOAuthClients: vi.fn(),
  revokeOAuthClient: vi.fn(),
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
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
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
        setupPrompt: "Use $ilo-setup to set up Ilo.",
        sourceUrl: "https://example.com/ilo-setup",
        version: "0.1.0",
      },
    });
    mocks.getAssistantSetupStatus.mockResolvedValue({
      domains: [
        {
          canRead: true,
          canWrite: true,
          domain: "mail",
          profileStatus: "active",
          profileVersion: 1,
        },
        {
          canRead: true,
          canWrite: true,
          domain: "calendar",
          profileStatus: null,
          profileVersion: null,
        },
      ],
    });
    mocks.listConnectors.mockResolvedValue([
      {
        calendarEnabled: true,
        email: "person@example.com",
        id,
        label: "Personal",
        lastSyncedAt: now,
        mailEnabled: true,
        provider: "google",
        syncError: null,
        syncStatus: "idle",
      },
    ]);
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
    ]);
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
    expect(await screen.findByText("2 connected")).toBeInTheDocument();
    expect(await screen.findByText("1 active approved Mail rule")).toBeInTheDocument();

    await browser.click(screen.getByRole("button", { name: "Copy Ilo MCP URL" }));
    await expect(navigator.clipboard.readText()).resolves.toBe("https://mcp.example.com/mcp");

    await browser.click(screen.getByRole("radio", { name: "Calendar" }));
    expect(screen.getByText("Preferences and attention items")).toBeInTheDocument();
    expect(screen.getByLabelText<HTMLTextAreaElement>("Calendar setup prompt").value).toContain(
      "set up my Calendar",
    );

    await browser.click(screen.getByRole("button", { name: "Revoke Claude" }));
    await waitFor(() => expect(mocks.revokeOAuthClient.mock.calls[0]?.[0]).toBe(id));

    await browser.click(screen.getByRole("button", { name: "Set up a local token" }));
    await browser.click(screen.getByRole("radio", { name: /Full Ilo/ }));
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

  it("keeps missing sources and connection-guide failures actionable", async () => {
    mocks.getAgentConnectionGuide.mockRejectedValue(new Error("Connection guide unavailable"));
    mocks.getAssistantSetupStatus.mockResolvedValue({ domains: [] });
    mocks.listConnectors.mockResolvedValue([]);
    mocks.listMailRules.mockResolvedValue([]);
    mocks.listAccessTokens.mockResolvedValue([]);
    mocks.listOAuthClients.mockResolvedValue([]);
    renderSettings();

    expect(await screen.findByText("Connection guide unavailable")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect Mail" })).toHaveAttribute(
      "href",
      "/settings?section=connections",
    );
    expect(screen.getByText("Not connected")).toBeInTheDocument();
  });
});
