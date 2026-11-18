import {
  type AgentAccount,
  type AgentAccountConnection,
  type AgentAccountDirectory,
  agentAccountUpdateSchema,
} from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { router, Stack, useNavigation } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { editorDismissOptions } from "../../components/editor-header";
import {
  Field,
  FormBody,
  Section,
  SectionFootnote,
  SectionNote,
} from "../../components/forms/form-rows";
import { FormSave } from "../../components/forms/form-save";
import { useDirtyDismiss } from "../../components/forms/use-dirty-dismiss";
import { useAuth } from "../auth/context";
import { Choice, confirm, State } from "../tasks/ui";
import { AgentAccess, AgentExecutionPolicy } from "./agent-access";
import { dateTime, platformLabels } from "./agent-copy";
import { AgentWorkItems } from "./agent-reviews";
import { PermissionBlock } from "./agent-rows";
import { AgentConnectionGuide, AgentWorkspaceSetup } from "./agent-setup";
import { useSettingsAction, useSettingsResource } from "./data";
import { SettingsDetailRow, SettingsRow } from "./settings-row";

export { tokenInput, tokenPresets } from "./agent-access";
export { agentWorkItemUrl } from "./agent-reviews";

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
              title: "Agent details",
              gestureEnabled: !dirty,
              ...editorDismissOptions({
                label: dirty ? "Cancel" : "Back",
                onPress: () =>
                  dirty
                    ? confirm(
                        "Discard agent details?",
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
            options={(Object.keys(platformLabels) as AgentAccount["platform"][]).map((value) => ({
              value,
              label: platformLabels[value],
            }))}
            onChange={(next) => setPlatform(next as AgentAccount["platform"])}
          />
        </Section>
        <SectionFootnote>
          The name and label are how this agent appears in nohmi. Changing them does not change what
          it can do.
        </SectionFootnote>
      </FormBody>
      <FormSave
        disabled={!dirty || action.pending}
        onPress={() =>
          void action.run(async (api) => {
            await api.updateAgentAccount(account.id, agentIdentityInput(name, label, platform));
            await refresh();
            onDone();
          }, "Agent details saved")
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
  const action = useSettingsAction();
  return (
    <Section title={`Connection · ${connection.label}`}>
      <SettingsDetailRow label="Status" value={connection.active ? "Active" : "Inactive"} />
      <SettingsDetailRow
        label="Last used"
        value={connection.lastUsedAt ? dateTime(connection.lastUsedAt) : "Never"}
      />
      <PermissionBlock scopes={connection.scopes} />
      <Choice
        label="Agent"
        icon="agent"
        value={connection.agentAccountId ?? "none"}
        disabled={action.pending}
        options={[
          { value: "none", label: "Not linked" },
          ...directory.accounts.map((account) => ({
            value: account.id,
            label: account.displayName,
          })),
        ]}
        onChange={(id) =>
          confirm(
            "Change this connection’s agent?",
            `${connection.label} will ${
              id === "none"
                ? "no longer be linked to an agent"
                : `appear as ${directory.accounts.find((account) => account.id === id)?.displayName}`
            }. This does not change its permissions.`,
            () =>
              void action.run(async (api) => {
                await api.linkAgentAccountConnection(connection.id, {
                  agentAccountId: id === "none" ? null : id,
                });
                await refresh();
              }, "Connection agent updated"),
          )
        }
      />
    </Section>
  );
}
function ConnectedAgents({
  directory,
  refresh,
  onEdit,
}: {
  directory: AgentAccountDirectory;
  refresh: () => Promise<unknown>;
  onEdit: (account: AgentAccount) => void;
}) {
  return (
    <>
      <Section title="Agents">
        <SectionNote>
          Each agent is an AI assistant you connected, such as Claude or Codex. Open one to change
          the name it appears under.
        </SectionNote>
        {directory.accounts.length === 0 && (
          <SectionNote ink>No agents have connected yet.</SectionNote>
        )}
        {directory.accounts.map((account) => (
          <SettingsRow
            key={account.id}
            label={account.displayName}
            value={account.accountLabel ?? platformLabels[account.platform]}
            icon="agent"
            onPress={() => onEdit(account)}
          />
        ))}
      </Section>
      {directory.connections.map((connection) => (
        <Connection
          key={connection.id}
          connection={connection}
          directory={directory}
          refresh={refresh}
        />
      ))}
    </>
  );
}
type AgentPage = "connected" | "setup" | "reviews" | "access" | "policy";
/**
 * True while the focused screen is the first one in its stack. The account menu opens Agents
 * that way, and the bar then has no back item of its own. The navigation state read during
 * render can still be the previous one, so this follows the state after mount instead.
 */
function useFirstInStack() {
  const navigation = useNavigation();
  const [first, setFirst] = useState(false);
  useEffect(() => {
    const update = () => {
      if (navigation.isFocused()) setFirst(navigation.getState()?.index === 0);
    };
    update();
    return navigation.addListener("state", update);
  }, [navigation]);
  return first;
}
export function AgentsSettingsScreen() {
  // Reached from Settings, the stack already supplies its own back item.
  const first = useFirstInStack();
  const back = editorDismissOptions({
    label: "Back",
    onPress: () => (router.canGoBack() ? router.back() : router.replace("/")),
  });
  // Header options persist once set, so the other case clears them explicitly.
  const none = Object.fromEntries(Object.keys(back).map((key) => [key, undefined]));
  return (
    <FormBody>
      <Stack.Screen options={first ? back : none} />
      <Section>
        <SettingsRow
          label="Connected agents"
          icon="agent"
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
          label="Review policy"
          icon="attention"
          onPress={() => router.push("/settings/agents/policy")}
        />
      </Section>
      <SectionFootnote>
        Agents are AI assistants, such as Claude or Codex, that you let work in nohmi. See who is
        connected, connect another, decide on the work they prepared, and control what they may do.
      </SectionFootnote>
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
  const cache = useQueryClient();
  const [editing, setEditing] = useState<AgentAccount | null>(null);
  const directory = useSettingsResource(
    "agent-directory",
    (api) => api.listAgentAccounts(),
    page === "connected",
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
                  policy: "Review policy",
                }[page],
                headerLeft: undefined,
                gestureEnabled: true,
              }}
            />
          )}
          {page === "connected" &&
            (directory.data ? (
              <ConnectedAgents directory={directory.data} refresh={refresh} onEdit={setEditing} />
            ) : (
              <Section title="Agents">
                <State
                  loading={directory.isPending}
                  retry={directory.isError ? () => void directory.refetch() : undefined}
                />
              </Section>
            ))}
          {page === "setup" && (
            <>
              <AgentConnectionGuide />
              <AgentWorkspaceSetup />
            </>
          )}
          {page === "reviews" && <AgentWorkItems />}
          {page === "access" && <AgentAccess />}
          {page === "policy" && <AgentExecutionPolicy />}
        </FormBody>
      </View>
    </View>
  );
}
