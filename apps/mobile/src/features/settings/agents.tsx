import { ApiClientError } from "@personal-os/api-client";
import {
  type AccessScope,
  type AgentAccessWorkItem,
  type AgentAccount,
  type AgentAccountConnection,
  type AgentAccountDirectory,
  type AssistantDomain,
  accessScopeSchema,
  agentAccountUpdateSchema,
  createAccessTokenInputSchema,
} from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { router, Stack } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Linking, Text, View } from "react-native";
import { toast } from "sonner-native";
import { editorDismissOptions } from "../../components/editor-header";
import { FormSave } from "../../components/forms/form-save";
import { useDirtyDismiss } from "../../components/forms/use-dirty-dismiss";
import { useTheme } from "../../theme";
import { useAuth } from "../auth/context";
import { errorMessage } from "../tasks/data";
import { Action, Choice, confirm, Field, FormBody, Section, State, ToggleRow } from "../tasks/ui";
import {
  type SettingsApi,
  useSettingsAction,
  useSettingsRefresh,
  useSettingsResource,
} from "./data";
import { SettingsRow } from "./settings-row";

export const tokenPresets: Array<{ description: string; name: string; scopes: AccessScope[] }> = [
  {
    description: "Learn your inbox preferences, preview rules, and run approved Mail rules.",
    name: "Mail setup",
    scopes: ["mail:read", "mail:write"],
  },
  {
    description: "Plan, create, and complete your day.",
    name: "Calendar & planning",
    scopes: [
      "calendar:read",
      "calendar:write",
      "reminders:read",
      "reminders:write",
      "tasks:read",
      "tasks:write",
      "automations:read",
    ],
  },
  {
    description: "Read your agenda, mail, and generated daily brief without changing them.",
    name: "Daily brief",
    scopes: ["calendar:read", "reminders:read", "mail:read", "automations:read"],
  },
  {
    description: "Create, manage, and audit all supported nohmi material.",
    name: "Full nohmi",
    scopes: [
      "calendar:read",
      "calendar:write",
      "reminders:read",
      "reminders:write",
      "tasks:read",
      "tasks:write",
      "tracking:read",
      "mail:read",
      "mail:write",
      "finances:read",
      "finances:write",
      "finances:maintain",
      "goals:read",
      "goals:write",
      "automations:read",
      "audit:read",
      "bookmarks:read",
      "texting:read",
      "texting:write",
    ],
  },
];

export function agentIdentityInput(
  displayName: string,
  accountLabel: string,
  platform: AgentAccount["platform"],
) {
  return agentAccountUpdateSchema.parse({
    displayName,
    accountLabel: accountLabel.trim() || null,
    platform,
  });
}
export function tokenInput(name: string, scopes: AccessScope[]) {
  return createAccessTokenInputSchema.parse({ name, scopes });
}
function Identity({
  account,
  refresh,
  onDone,
}: {
  account: AgentAccount;
  refresh: () => Promise<unknown>;
  onDone: () => void;
}) {
  const action = useSettingsAction();
  const [name, setName] = useState(account.displayName);
  const [label, setLabel] = useState(account.accountLabel ?? "");
  const [platform, setPlatform] = useState(account.platform);
  const dirty =
    name !== account.displayName ||
    label !== (account.accountLabel ?? "") ||
    platform !== account.platform;
  useDirtyDismiss(dirty, action.pending);
  return (
    <View style={{ flex: 1 }}>
      <FormBody>
        <Section title={account.displayName}>
          <Stack.Screen
            options={{
              title: "Agent identity",
              gestureEnabled: !dirty,
              ...editorDismissOptions({
                label: dirty ? "Cancel" : "Back",
                onPress: () =>
                  dirty
                    ? confirm(
                        "Discard identity changes?",
                        "Your unsaved changes will be lost.",
                        onDone,
                        true,
                      )
                    : onDone(),
                disabled: action.pending,
              }),
            }}
          />
          <Field
            label="Name"
            value={name}
            onChangeText={setName}
            maxLength={80}
            editable={!action.pending}
          />
          <Field
            label="Account label"
            icon="profile"
            value={label}
            onChangeText={setLabel}
            maxLength={80}
            editable={!action.pending}
            placeholder="Personal account"
          />
          <Choice
            label="Platform"
            icon="disconnected"
            value={platform}
            disabled={action.pending}
            options={["claude", "codex", "other", "unknown"].map((value) => ({
              value,
              label: value.charAt(0).toUpperCase() + value.slice(1),
            }))}
            onChange={(next) => setPlatform(next as AgentAccount["platform"])}
          />
        </Section>
      </FormBody>
      <FormSave
        disabled={!dirty || action.pending}
        onPress={() =>
          void action.run(async (api) => {
            await api.updateAgentAccount(account.id, agentIdentityInput(name, label, platform));
            await refresh();
            onDone();
          }, "Agent identity saved")
        }
      />
    </View>
  );
}
function Connection({
  connection,
  directory,
  refresh,
}: {
  connection: AgentAccountConnection;
  directory: AgentAccountDirectory;
  refresh: () => Promise<unknown>;
}) {
  const t = useTheme();
  const action = useSettingsAction();
  return (
    <Section title={connection.label}>
      <Text style={{ color: t.secondary, padding: 16 }}>
        {connection.active ? "Active" : "Inactive"} · Last used{" "}
        {connection.lastUsedAt ? new Date(connection.lastUsedAt).toLocaleString() : "never"}
      </Text>
      <Text selectable style={{ color: t.ink, padding: 16 }}>
        Granted scopes: {connection.scopes.join(", ") || "none"}
      </Text>
      <Choice
        label="Agent identity"
        icon="profile"
        value={connection.agentAccountId ?? "none"}
        disabled={action.pending}
        options={[
          { value: "none", label: "Unlinked" },
          ...directory.accounts.map((account) => ({
            value: account.id,
            label: account.displayName,
          })),
        ]}
        onChange={(id) =>
          confirm(
            "Change connection identity?",
            `Associate ${connection.label} with ${id === "none" ? "no agent identity" : directory.accounts.find((account) => account.id === id)?.displayName}. This does not add scopes.`,
            () =>
              void action.run(async (api) => {
                await api.linkAgentAccountConnection(connection.id, {
                  agentAccountId: id === "none" ? null : id,
                });
                await refresh();
              }, "Connection identity updated"),
          )
        }
      />
    </Section>
  );
}
function Authority({
  onPendingChange,
  page,
}: {
  onPendingChange: (pending: boolean) => void;
  page: "access" | "policy";
}) {
  const t = useTheme();
  const action = useSettingsAction();
  const tokens = useSettingsResource(
    "agent-tokens",
    (api) => api.listAccessTokens(),
    page === "access",
  );
  const clients = useSettingsResource(
    "agent-oauth-clients",
    (api) => api.listOAuthClients(),
    page === "access",
  );
  const policy = useSettingsResource(
    "agent-execution-policy",
    (api) => api.getExecutionPolicySettings(),
    page === "policy",
    true,
  );
  const { state, session } = useAuth();
  const policyRefresh = useSettingsRefresh(
    [["settings", state.user?.id, session.epoch(), "agent-execution-policy"]],
    [policy.refetch],
    "Execution policy refreshed",
    "action",
  );
  const initialPolicyFeedback = useRef(true);
  useEffect(() => {
    if (page !== "policy" || !initialPolicyFeedback.current) return;
    if (policy.data) initialPolicyFeedback.current = false;
    else if (policy.error) {
      initialPolicyFeedback.current = false;
      toast.error(errorMessage(policy.error));
    }
  }, [page, policy.data, policy.error]);
  const refreshPolicy = () => {
    initialPolicyFeedback.current = false;
    void policyRefresh.refresh();
  };
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<AccessScope[]>([]);
  const [secret, setSecret] = useState<string | null>(null);
  const selectedPreset =
    tokenPresets.find(
      (preset) =>
        preset.scopes.length === scopes.length &&
        preset.scopes.every((scope) => scopes.includes(scope)),
    )?.name ?? "custom";
  useEffect(() => {
    onPendingChange(action.pending);
  }, [action.pending, onPendingChange]);
  useDirtyDismiss(!!secret || !!name.trim() || scopes.length > 0, action.pending);
  const revoke = (
    label: string,
    operation: (api: SettingsApi) => Promise<unknown>,
    refresh: () => Promise<unknown>,
  ) =>
    confirm(
      `Revoke ${label}?`,
      "This connection will lose access to nohmi. Existing queued work may no longer be able to continue.",
      () =>
        void action.run(async (api) => {
          await operation(api);
          await refresh();
        }, "Access revoked"),
      true,
    );
  return (
    <>
      {page === "policy" && (
        <Section title="Execution policy">
          <Text style={{ color: t.secondary, padding: 16 }}>
            Review bypass applies only to registered reversible operations. Required scopes,
            explicit approvals and unavailable capabilities still apply.
          </Text>
          {policy.data ? (
            <ToggleRow
              label="Allow eligible actions without review"
              icon="check"
              value={policy.data.reviewBypassEnabled}
              disabled={action.pending}
              onChange={(reviewBypassEnabled) => {
                const current = policy.data;
                if (!current) return;
                confirm(
                  reviewBypassEnabled ? "Enable review bypass?" : "Require review?",
                  reviewBypassEnabled
                    ? "Eligible registered reversible Finance actions may execute without the review queue. This does not grant scopes or bypass explicit approval requirements."
                    : "Eligible actions will return to the review queue.",
                  () =>
                    void action.run(async (api) => {
                      await api.updateExecutionPolicySettings({
                        expectedVersion: current.version,
                        reviewBypassEnabled,
                      });
                      await policy.refetch();
                    }, "Execution policy saved"),
                );
              }}
            />
          ) : (
            <State loading={policy.isPending} retry={policy.isError ? refreshPolicy : undefined} />
          )}
          <Action
            label="Refresh execution policy"
            disabled={action.pending || policyRefresh.pending}
            onPress={refreshPolicy}
          />
        </Section>
      )}
      {page === "access" && (
        <>
          <Section title="Access tokens">
            {tokens.data?.map((token) => (
              <Section key={token.id} title={token.name}>
                <Text selectable style={{ color: t.ink, padding: 16 }}>
                  {token.scopes.join(", ")}
                </Text>
                <Text style={{ color: t.secondary, paddingHorizontal: 16 }}>
                  {token.revokedAt
                    ? "Revoked"
                    : token.expiresAt
                      ? `Expires ${new Date(token.expiresAt).toLocaleString()}`
                      : "No expiry"}
                </Text>
                {!token.revokedAt && (
                  <Action
                    label={`Revoke ${token.name}`}
                    disabled={action.pending}
                    destructive
                    onPress={() =>
                      revoke(token.name, (api) => api.deleteAccessToken(token.id), tokens.refetch)
                    }
                  />
                )}
              </Section>
            ))}
            {!tokens.data && (
              <State
                loading={tokens.isPending}
                retry={tokens.isError ? () => void tokens.refetch() : undefined}
              />
            )}
            {tokens.data?.length === 0 && <State empty="No access tokens." />}
          </Section>
          <Section title="Create access token">
            <Text style={{ color: t.secondary, padding: 16 }}>
              Select only the scopes this connection needs. Read scopes can expose private records;
              write, execute and maintain scopes can change them. The token will appear once.
            </Text>
            <Field
              label="Token name"
              icon="disconnected"
              value={name}
              onChangeText={setName}
              editable={!action.pending && !secret}
              maxLength={80}
              placeholder="My agent connection"
            />
            <Choice
              label="Permission preset"
              value={selectedPreset}
              disabled={action.pending || !!secret}
              options={[
                { value: "custom", label: "Custom permissions" },
                ...tokenPresets.map((preset) => ({ value: preset.name, label: preset.name })),
              ]}
              onChange={(name) => {
                const preset = tokenPresets.find((preset) => preset.name === name);
                if (preset) setScopes([...preset.scopes]);
              }}
            />
            {accessScopeSchema.options
              .filter((scope) => scope !== "automations:write" && scope !== "tracking:write")
              .map((scope) => (
                <ToggleRow
                  key={scope}
                  label={scope}
                  value={scopes.includes(scope)}
                  disabled={action.pending || !!secret}
                  onChange={(selected) =>
                    setScopes((current) =>
                      selected ? [...current, scope] : current.filter((value) => value !== scope),
                    )
                  }
                />
              ))}
            <Action
              label="Create token"
              disabled={action.pending || !name.trim() || !scopes.length || !!secret}
              onPress={() =>
                confirm(
                  "Grant agent access?",
                  `${name.trim()} will receive these scopes: ${scopes.join(", ")}. Keep its token private.`,
                  () =>
                    void action.run(async (api) => {
                      const created = await api.createAccessToken(tokenInput(name, scopes));
                      setSecret(created.token);
                      setName("");
                      setScopes([]);
                      await tokens.refetch();
                    }, "Access token created"),
                )
              }
            />
            {secret && (
              <>
                <Text style={{ color: t.warning, padding: 16 }}>
                  Save this token somewhere private. It cannot be retrieved again after you dismiss
                  it.
                </Text>
                <Text
                  selectable
                  accessibilityLabel="New access token"
                  style={{ color: t.ink, padding: 16 }}
                >
                  {secret}
                </Text>
                <Action label="I saved the token" onPress={() => setSecret(null)} />
              </>
            )}
          </Section>
          <Section title="Authorized applications">
            {clients.data?.map((client) => (
              <Section key={client.id} title={client.name}>
                <Text selectable style={{ color: t.ink, padding: 16 }}>
                  {client.scopes.join(", ") || "No scopes"}
                </Text>
                <Action
                  label={`Revoke ${client.name}`}
                  disabled={action.pending}
                  destructive
                  onPress={() =>
                    revoke(client.name, (api) => api.revokeOAuthClient(client.id), clients.refetch)
                  }
                />
              </Section>
            ))}
            {!clients.data && (
              <State
                loading={clients.isPending}
                retry={clients.isError ? () => void clients.refetch() : undefined}
              />
            )}
            {clients.data?.length === 0 && <State empty="No authorized applications." />}
          </Section>
        </>
      )}
    </>
  );
}
type AgentPage = "connected" | "setup" | "reviews" | "access" | "policy";
export function AgentsSettingsScreen() {
  return (
    <FormBody>
      <Section>
        <SettingsRow
          label="Connected agents"
          icon="people"
          onPress={() => router.push("/settings/agents/connected")}
        />
        <SettingsRow
          label="Setup"
          icon="settings"
          onPress={() => router.push("/settings/agents/setup")}
        />
        <SettingsRow
          label="Reviews"
          icon="check"
          onPress={() => router.push("/settings/agents/reviews")}
        />
        <SettingsRow
          label="Access"
          icon="profile"
          onPress={() => router.push("/settings/agents/access")}
        />
        <SettingsRow
          label="Execution policy"
          icon="settings"
          onPress={() => router.push("/settings/agents/policy")}
        />
      </Section>
    </FormBody>
  );
}
function AgentPageScreen({ page }: { page: AgentPage }) {
  const { state, session } = useAuth();
  return state.user ? (
    <AgentSettings key={`${state.user.id}-${session.epoch()}-${page}`} page={page} />
  ) : null;
}
export function ConnectedAgentsScreen() {
  return <AgentPageScreen page="connected" />;
}
export function AgentSetupScreen() {
  return <AgentPageScreen page="setup" />;
}
export function AgentReviewsScreen() {
  return <AgentPageScreen page="reviews" />;
}
export function AgentAccessScreen() {
  return <AgentPageScreen page="access" />;
}
export function AgentPolicyScreen() {
  return <AgentPageScreen page="policy" />;
}

function AgentSettings({ page }: { page: AgentPage }) {
  const t = useTheme();
  const cache = useQueryClient();
  const [editing, setEditing] = useState<AgentAccount | null>(null);
  const [authorityPending, setAuthorityPending] = useState(false);
  const directory = useSettingsResource(
    "agent-directory",
    (api) => api.listAgentAccounts(),
    page === "connected",
  );
  const guide = useSettingsResource(
    "agent-guide",
    (api) => api.getAgentConnectionGuide(),
    page === "setup",
  );
  const refresh = async () => {
    await directory.refetch();
    await cache.invalidateQueries({ queryKey: ["settings"] });
  };
  return (
    <View style={{ flex: 1 }}>
      {editing && <Identity account={editing} refresh={refresh} onDone={() => setEditing(null)} />}
      <View style={{ flex: 1, display: editing ? "none" : "flex" }}>
        <FormBody>
          {!editing && (
            <Stack.Screen
              options={{
                title: {
                  connected: "Connected agents",
                  setup: "Agent setup",
                  reviews: "Reviews",
                  access: "Access",
                  policy: "Execution policy",
                }[page],
                headerLeft: undefined,
                gestureEnabled: true,
              }}
            />
          )}
          {page === "setup" && (
            <Section title="Connect an agent">
              {guide.data ? (
                <>
                  <Text selectable style={{ color: t.ink, padding: 16 }}>
                    MCP endpoint: {guide.data.mcpUrl}
                  </Text>
                  <Text selectable style={{ color: t.ink, padding: 16 }}>
                    {guide.data.skill.installPrompt}
                  </Text>
                  <Text selectable style={{ color: t.secondary, padding: 16 }}>
                    {guide.data.skill.setupPrompt}
                  </Text>
                  {guide.data.domains.map((domain) => (
                    <Text key={domain.domain} style={{ color: t.secondary, padding: 16 }}>
                      {domain.domain}: {domain.support.replaceAll("_", " ")} · {domain.readScope} ·{" "}
                      {domain.writeScope}
                    </Text>
                  ))}
                </>
              ) : (
                <State
                  loading={guide.isPending}
                  retry={guide.isError ? () => void guide.refetch() : undefined}
                />
              )}
            </Section>
          )}
          {page === "connected" &&
            (directory.data ? (
              <>
                {directory.data.accounts.map((account) => (
                  <Action
                    key={account.id}
                    label={`Edit ${account.displayName}`}
                    disabled={authorityPending}
                    onPress={() => setEditing(account)}
                  />
                ))}
                {directory.data.accounts.length === 0 && (
                  <State empty="No agents have connected yet." />
                )}
                {directory.data.connections.map((connection) => (
                  <Connection
                    key={connection.id}
                    connection={connection}
                    directory={directory.data}
                    refresh={refresh}
                  />
                ))}
              </>
            ) : (
              <State
                loading={directory.isPending}
                retry={directory.isError ? () => void directory.refetch() : undefined}
              />
            ))}
          {page === "setup" && <AgentSetup />}
          {page === "reviews" && <AgentWorkItems />}
          {(page === "access" || page === "policy") && (
            <Authority page={page} onPendingChange={setAuthorityPending} />
          )}
        </FormBody>
      </View>
    </View>
  );
}

function AgentSetup() {
  const t = useTheme();
  const [domain, setDomain] = useState<AssistantDomain>("tasks");
  const status = useSettingsResource("agent-setup-status", (api) => api.getAssistantSetupStatus());
  const setup = useSettingsResource(`agent-setup-${domain}`, (api) =>
    api.getPersonalOsSetup({ domain }),
  );
  return (
    <Section title="Workspace setup">
      <Choice
        label="Workspace"
        icon="grid"
        value={domain}
        options={["tasks", "mail", "calendar", "finances"].map((value) => ({
          value,
          label: value.charAt(0).toUpperCase() + value.slice(1),
          icon: value as "tasks" | "mail" | "calendar" | "finances",
        }))}
        onChange={(value) => setDomain(value as AssistantDomain)}
      />
      {status.data?.domains
        .filter((item) => item.domain === domain)
        .map((item) => (
          <Text key={item.domain} style={{ color: t.secondary, padding: 16 }}>
            Agent access: {item.canRead ? "read" : "no read"} ·{" "}
            {item.canWrite ? "write" : "no write"}. Approved guidance version{" "}
            {item.approvedProfileVersion ?? "none"}; pending draft version{" "}
            {item.pendingDraftVersion ?? "none"}.
          </Text>
        ))}
      {status.isError && (
        <Action label="Retry setup status" onPress={() => void status.refetch()} />
      )}
      {setup.data ? (
        <>
          <Text style={{ color: t.ink, padding: 16 }}>
            {humanSetup(setup.data.status)} · {setup.data.progress.completed} of{" "}
            {setup.data.progress.total} steps. {setup.data.nextAction}
          </Text>
          {setup.data.steps.map((step) => (
            <Section key={step.id} title={step.title}>
              <Text style={{ color: t.secondary, padding: 16 }}>
                {humanSetup(step.state)} · Owned by {step.owner}. {step.description}
              </Text>
              {step.instructions.map((instruction) => (
                <Text key={instruction} selectable style={{ color: t.ink, padding: 16 }}>
                  {instruction}
                </Text>
              ))}
              {step.userAction && (
                <Text selectable style={{ color: t.ink, padding: 16 }}>
                  {step.userAction}
                </Text>
              )}
            </Section>
          ))}
        </>
      ) : (
        <State
          loading={setup.isPending}
          retry={setup.isError ? () => void setup.refetch() : undefined}
        />
      )}
    </Section>
  );
}
const humanSetup = (value: string) => value.replaceAll("_", " ");
export function agentWorkItemUrl(base: string, path: string) {
  const parsed = new URL(base);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    !/^\/(?![\\/])/.test(path)
  )
    throw new Error("The web review address is invalid.");
  const target = new URL(path, parsed.origin);
  if (target.origin !== parsed.origin) throw new Error("The web review address is invalid.");
  return target.toString();
}
function AgentWorkItems() {
  const t = useTheme();
  const action = useSettingsAction();
  const [cursor, setCursor] = useState<string | undefined>();
  const [previous, setPrevious] = useState<AgentAccessWorkItem[]>([]);
  const context = useSettingsResource("agent-context", (api) => api.getPersonalOsContext());
  const page = useSettingsResource(`agent-work-items-${cursor ?? "root"}`, (api) =>
    api.listAgentAccessWorkItems({ limit: 10, ...(cursor ? { cursor } : {}) }),
  );
  const access = useRef({
    live: true,
    epoch: 0,
    pageBlocked: false,
    contextBlocked: false,
    items: [] as AgentAccessWorkItem[],
    nextCursor: null as string | null,
  });
  const pageDenied =
    page.error instanceof ApiClientError &&
    (page.error.status === 401 || page.error.status === 403);
  const contextDenied =
    context.error instanceof ApiClientError &&
    (context.error.status === 401 || context.error.status === 403);
  if (
    (pageDenied && !access.current.pageBlocked) ||
    (contextDenied && !access.current.contextBlocked)
  )
    access.current.epoch += 1;
  if (pageDenied) access.current.pageBlocked = true;
  else if (page.isSuccess && !page.isFetching && page.data) access.current.pageBlocked = false;
  if (contextDenied) access.current.contextBlocked = true;
  else if (context.isSuccess && !context.isFetching && context.data)
    access.current.contextBlocked = false;
  const denied = access.current.pageBlocked || access.current.contextBlocked;
  useEffect(() => {
    access.current.live = true;
    return () => {
      access.current.live = false;
    };
  }, []);
  useEffect(() => {
    if (denied) setPrevious([]);
  }, [denied]);
  // The denial latch survives retry's error reset; captured native callbacks use the live fence.
  const items = denied
    ? []
    : [
        ...new Map(
          [...previous, ...(page.data?.items ?? [])].map((item) => [item.id, item]),
        ).values(),
      ];
  access.current.items = items;
  access.current.nextCursor = denied ? null : (page.data?.nextCursor ?? null);
  const callbackEpoch = access.current.epoch;
  const canAct = () =>
    access.current.live &&
    !access.current.pageBlocked &&
    !access.current.contextBlocked &&
    access.current.epoch === callbackEpoch;
  const canOpen = (item: AgentAccessWorkItem) =>
    canAct() &&
    access.current.items.some(
      (current) => current.id === item.id && current.action?.to === item.action?.to,
    );
  return (
    <Section title="Agent work and reviews">
      {!denied && page.data?.unavailableDomains.length ? (
        <Text style={{ color: t.warning, padding: 16 }}>
          Could not load: {page.data.unavailableDomains.join(", ")}. Other work remains visible.
        </Text>
      ) : null}
      {items.map((item) => (
        <Section key={item.id} title={item.title}>
          <Text style={{ color: t.secondary, padding: 16 }}>
            {item.domain ?? "Account"} · {humanSetup(item.priority)} · {humanSetup(item.kind)}
          </Text>
          <Text style={{ color: t.ink, padding: 16 }}>{item.summary}</Text>
          {item.preview?.map((field) => (
            <Text key={field.label} style={{ color: t.ink, padding: 16 }}>
              {field.label}: {field.value}
            </Text>
          ))}
          {item.action && context.data && (
            <Action
              label={`${item.action.label} on the web`}
              disabled={action.pending}
              onPress={() => {
                if (!canOpen(item)) return;
                confirm(
                  "Continue on the web?",
                  "Open this item's existing web flow. Review and complete any action there; opening it does not approve or apply anything.",
                  () => {
                    if (!canOpen(item)) return;
                    void action.run(async () => {
                      if (!canOpen(item)) return;
                      await Linking.openURL(
                        agentWorkItemUrl(context.data.links.agentAccess, item.action?.to ?? ""),
                      );
                    }, "Requested opening the web flow");
                  },
                );
              }}
            />
          )}
        </Section>
      ))}
      {page.isPending && <State loading />}
      {page.isError && (
        <Action label="Retry loading agent work" onPress={() => void page.refetch()} />
      )}
      {!denied && page.data && items.length === 0 && <State empty="No agent work is waiting." />}
      {!denied && page.data?.nextCursor && (
        <Action
          label="Load more agent work"
          disabled={page.isFetching}
          onPress={() => {
            if (!canAct() || access.current.nextCursor !== page.data?.nextCursor) return;
            setPrevious(access.current.items);
            setCursor(access.current.nextCursor ?? undefined);
          }}
        />
      )}
      {context.isError && (
        <Action label="Retry web review links" onPress={() => void context.refetch()} />
      )}
    </Section>
  );
}
