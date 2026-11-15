import {
  type AccessScope,
  accessScopeSchema,
  createAccessTokenInputSchema,
} from "@personal-os/domain";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner-native";
import {
  Field,
  Section,
  SectionFootnote,
  SectionNote,
  ToggleRow,
} from "../../components/forms/form-rows";
import { useDirtyDismiss } from "../../components/forms/use-dirty-dismiss";
import { useAuth } from "../auth/context";
import { errorMessage } from "../tasks/data";
import { Choice, confirm, State } from "../tasks/ui";
import { dateTime, permissionRecap, scopeDetails, scopeGroups, scopeLabels } from "./agent-copy";
import { DetailBlock, PermissionBlock } from "./agent-rows";
import {
  type SettingsApi,
  useSettingsAction,
  useSettingsRefresh,
  useSettingsResource,
} from "./data";
import { SettingsActionRow, SettingsDetailRow } from "./settings-row";

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

export function tokenInput(name: string, scopes: AccessScope[]) {
  return createAccessTokenInputSchema.parse({ name, scopes });
}

const selectableScopes = accessScopeSchema.options.filter(
  (scope) => scope !== "automations:write" && scope !== "tracking:write",
);
const selectableGroups = scopeGroups(selectableScopes);

/** Review policy: whether eligible agent work may skip the review queue. */
export function AgentExecutionPolicy() {
  const action = useSettingsAction();
  const policy = useSettingsResource(
    "agent-execution-policy",
    (api) => api.getExecutionPolicySettings(),
    true,
    true,
  );
  const { state, session } = useAuth();
  const policyRefresh = useSettingsRefresh(
    [["settings", state.user?.id, session.epoch(), "agent-execution-policy"]],
    [policy.refetch],
    "Review policy refreshed",
    "action",
  );
  const initialPolicyFeedback = useRef(true);
  useEffect(() => {
    if (!initialPolicyFeedback.current) return;
    if (policy.data) initialPolicyFeedback.current = false;
    else if (policy.error) {
      initialPolicyFeedback.current = false;
      toast.error(errorMessage(policy.error));
    }
  }, [policy.data, policy.error]);
  const refreshPolicy = () => {
    initialPolicyFeedback.current = false;
    void policyRefresh.refresh();
  };
  useDirtyDismiss(false, action.pending);
  return (
    <>
      <Section title="Eligible agent work">
        {policy.data ? (
          <ToggleRow
            label="Apply eligible work without waiting in Review"
            icon="check"
            value={policy.data.reviewBypassEnabled}
            disabled={action.pending}
            onChange={(reviewBypassEnabled) => {
              const current = policy.data;
              if (!current) return;
              confirm(
                reviewBypassEnabled
                  ? "Apply eligible work without review?"
                  : "Send eligible work to Reviews?",
                reviewBypassEnabled
                  ? "Eligible work will be applied without waiting in Reviews. This currently applies only to reversible Finance changes that your rules allow. Permissions, questions and required approvals still apply."
                  : "Eligible work will wait in Reviews until you decide.",
                () =>
                  void action.run(async (api) => {
                    await api.updateExecutionPolicySettings({
                      expectedVersion: current.version,
                      reviewBypassEnabled,
                    });
                    await policy.refetch();
                  }, "Review policy saved"),
              );
            }}
          />
        ) : (
          <State loading={policy.isPending} retry={policy.isError ? refreshPolicy : undefined} />
        )}
      </Section>
      <SectionFootnote>
        Off by default: eligible work waits in Reviews until you decide. When on, this currently
        applies only to reversible Finance changes that your rules allow. Permissions, questions and
        required approvals still apply.
      </SectionFootnote>
      <Section>
        <SettingsActionRow
          label="Refresh review policy"
          icon="refresh"
          disabled={action.pending || policyRefresh.pending}
          onPress={refreshPolicy}
        />
      </Section>
    </>
  );
}

/** Access: the tokens and apps that can reach nohmi, and creating a new token. */
export function AgentAccess() {
  const action = useSettingsAction();
  const tokens = useSettingsResource("agent-tokens", (api) => api.listAccessTokens());
  const clients = useSettingsResource("agent-oauth-clients", (api) => api.listOAuthClients());
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<AccessScope[]>([]);
  const [secret, setSecret] = useState<string | null>(null);
  const selectedPreset =
    tokenPresets.find(
      (preset) =>
        preset.scopes.length === scopes.length &&
        preset.scopes.every((scope) => scopes.includes(scope)),
    )?.name ?? "custom";
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
  const locked = action.pending || !!secret;
  return (
    <>
      <Section title="Access tokens">
        <SectionNote>
          A token is a private key for an agent that runs on your own computer. Anyone holding it
          can use the permissions listed with it.
        </SectionNote>
        {!tokens.data && (
          <State
            loading={tokens.isPending}
            retry={tokens.isError ? () => void tokens.refetch() : undefined}
          />
        )}
        {tokens.data?.length === 0 && <SectionNote ink>No access tokens.</SectionNote>}
      </Section>
      {tokens.data?.map((token) => (
        <Section key={token.id} title={`Token · ${token.name}`}>
          <SettingsDetailRow
            label="Status"
            value={
              token.revokedAt
                ? "Revoked"
                : token.expiresAt
                  ? `Expires ${dateTime(token.expiresAt)}`
                  : "Active, no expiry"
            }
            attention={!!token.revokedAt}
          />
          <PermissionBlock scopes={token.scopes} />
          {!token.revokedAt && (
            <SettingsActionRow
              label={`Revoke ${token.name}`}
              icon="trash"
              disabled={action.pending}
              destructive
              onPress={() =>
                revoke(token.name, (api) => api.deleteAccessToken(token.id), tokens.refetch)
              }
            />
          )}
        </Section>
      ))}
      <Section title="Connected apps">
        <SectionNote>
          Apps you signed in to nohmi from, such as Claude or Codex. Revoking one signs it out.
        </SectionNote>
        {!clients.data && (
          <State
            loading={clients.isPending}
            retry={clients.isError ? () => void clients.refetch() : undefined}
          />
        )}
        {clients.data?.length === 0 && <SectionNote ink>No connected apps.</SectionNote>}
      </Section>
      {clients.data?.map((client) => (
        <Section key={client.id} title={`App · ${client.name}`}>
          <PermissionBlock scopes={client.scopes} />
          <SettingsActionRow
            label={`Revoke ${client.name}`}
            icon="trash"
            disabled={action.pending}
            destructive
            onPress={() =>
              revoke(client.name, (api) => api.revokeOAuthClient(client.id), clients.refetch)
            }
          />
        </Section>
      ))}
      {secret ? (
        <Section title="Your new token">
          <SectionNote warning>
            Save this token somewhere private. It cannot be retrieved again after you dismiss it.
          </SectionNote>
          <DetailBlock label="New access token" lines={[secret]} selectable />
          <SettingsActionRow
            label="I saved the token"
            icon="check"
            onPress={() => setSecret(null)}
          />
        </Section>
      ) : (
        <>
          <Section title="Create a token">
            <SectionNote>
              Choose only the permissions this agent needs. Reading can expose private records;
              managing, executing and maintaining can change them. The token is shown once.
            </SectionNote>
            <Field
              label="Token name"
              icon="disconnected"
              value={name}
              onChangeText={setName}
              editable={!locked}
              maxLength={80}
              placeholder="My agent connection"
            />
            <Choice
              label="Permission preset"
              value={selectedPreset}
              disabled={locked}
              options={[
                { value: "custom", label: "Custom permissions" },
                ...tokenPresets.map((preset) => ({ value: preset.name, label: preset.name })),
              ]}
              onChange={(name) => {
                const preset = tokenPresets.find((preset) => preset.name === name);
                if (preset) setScopes([...preset.scopes]);
              }}
            />
          </Section>
          {selectableGroups.map((group) => (
            <Section key={group.area} title={`${group.label} permissions`}>
              {group.scopes.map((scope) => (
                <ToggleRow
                  key={scope}
                  label={scopeLabels[scope]}
                  detail={scopeDetails[scope]}
                  value={scopes.includes(scope)}
                  disabled={locked}
                  onChange={(selected) =>
                    setScopes((current) =>
                      selected ? [...current, scope] : current.filter((value) => value !== scope),
                    )
                  }
                />
              ))}
            </Section>
          ))}
          <Section>
            <SettingsActionRow
              label="Create token"
              icon="add"
              disabled={action.pending || !name.trim() || !scopes.length}
              onPress={() =>
                confirm(
                  "Grant agent access?",
                  `${name.trim()} will receive these permissions:\n${permissionRecap(
                    scopes,
                  )}\nKeep its token private.`,
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
          </Section>
        </>
      )}
    </>
  );
}
