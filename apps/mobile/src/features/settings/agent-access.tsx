import {
  type AccessScope,
  accessScopeSchema,
  createAccessTokenInputSchema,
} from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
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
import { confirmedRejection } from "../finances/mutations";
import { errorMessage } from "../tasks/data";
import { Choice, confirm, State } from "../tasks/ui";
import {
  dateTime,
  permissionRecap,
  scopeDetails,
  scopeGroups,
  scopeLabels,
  toggleScope,
} from "./agent-copy";
import { DetailBlock, PermissionBlock } from "./agent-rows";
import {
  type SettingsApi,
  useSettingsAction,
  useSettingsRefresh,
  useSettingsResource,
} from "./data";
import { SettingsActionRow, SettingsDetailRow } from "./settings-row";

/** Memory is on by default for new tokens (spec §5.11); the person can still switch it off. */
const memoryScopes: AccessScope[] = ["knowledge:read", "knowledge:write"];

export const tokenPresets: Array<{ description: string; name: string; scopes: AccessScope[] }> = [
  {
    description: "Learn your inbox preferences, preview rules, and run approved Mail rules.",
    name: "Mail setup",
    scopes: ["mail:read", "mail:write", ...memoryScopes],
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
      ...memoryScopes,
    ],
  },
  {
    description: "Read your agenda, mail, and generated daily brief without changing them.",
    name: "Daily brief",
    // Read-only preset: it may read memory but never saves it.
    scopes: ["calendar:read", "reminders:read", "mail:read", "automations:read", "knowledge:read"],
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
      ...memoryScopes,
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
  const client = useQueryClient();
  const policy = useSettingsResource(
    "agent-execution-policy",
    (api) => api.getExecutionPolicySettings(),
    true,
    true,
  );
  const { state, session } = useAuth();
  const policyKey = ["settings", state.user?.id, session.epoch(), "agent-execution-policy"];
  // An explicit refresh reports its own failure through its toast; this marks that failure
  // as owned as soon as the read settles, before the screen renders it.
  const ownedError = useRef(0);
  const policyRefresh = useSettingsRefresh(
    [policyKey],
    [
      async () => {
        const result = await policy.refetch();
        if (result.error) ownedError.current = result.errorUpdatedAt;
        return result;
      },
    ],
    "Review policy refreshed",
    "action",
  );
  // Every other failed read (the first one, or a later background one over cached data) is
  // reported here once, because this query opts out of the global read feedback.
  const reportedError = useRef(0);
  useEffect(() => {
    if (!policy.error) return;
    const failedAt = policy.errorUpdatedAt ?? 0;
    if (failedAt === ownedError.current || failedAt === reportedError.current) return;
    reportedError.current = failedAt;
    toast.error(errorMessage(policy.error));
  }, [policy.error, policy.errorUpdatedAt]);
  // A save whose outcome is unknown (timeout, lost connection, server fault) keeps the
  // attempted value on screen and blocks further changes until an explicit refresh shows what
  // the server holds. The marker lives in the cache beside the policy, so leaving and
  // reopening the screen cannot present the cached value as the saved one.
  const unconfirmedKey = [...policyKey, "unconfirmed"];
  const [unconfirmed, setUnconfirmed] = useState<boolean | null>(
    () => client.getQueryData<boolean>(unconfirmedKey) ?? null,
  );
  const markUnconfirmed = async (attempted: boolean) => {
    client.setQueryDefaults(unconfirmedKey, { gcTime: Number.POSITIVE_INFINITY });
    client.setQueryData(unconfirmedKey, attempted);
    setUnconfirmed(attempted);
    await client.invalidateQueries({ queryKey: policyKey, exact: true, refetchType: "none" });
  };
  const refreshPolicy = async () => {
    const result = await policyRefresh.refresh();
    if (!result?.ok) return;
    client.removeQueries({ queryKey: unconfirmedKey, exact: true });
    setUnconfirmed(null);
  };
  const save = async (expectedVersion: number, reviewBypassEnabled: boolean) => {
    let attempted = false;
    let failure: unknown;
    const result = await action.run(async (api) => {
      attempted = true;
      try {
        const saved = await api.updateExecutionPolicySettings({
          expectedVersion,
          reviewBypassEnabled,
        });
        // The accepted policy is the server's answer. A read that started before the save
        // must not land after it and restore the old value and version.
        await client.cancelQueries({ queryKey: policyKey, exact: true });
        client.setQueryData(policyKey, saved);
      } catch (error) {
        failure = error;
        throw error;
      }
    }, "Review policy saved");
    // Not sent at all (another action was running, or the session changed): nothing to recover.
    if (result?.ok || !attempted) return;
    if (!confirmedRejection(failure)) return markUnconfirmed(reviewBypassEnabled);
    // A definite rejection wrote nothing, so the switch stays on the saved policy. A conflict
    // means that policy is out of date, so read it again.
    if (failure.status === 409) await policy.refetch();
  };
  useDirtyDismiss(false, action.pending);
  const busy = action.pending || policyRefresh.pending || policy.isFetching;
  return (
    <>
      <Section title="Eligible agent work">
        {policy.data ? (
          <ToggleRow
            label="Apply eligible work without waiting in Review"
            detail={
              unconfirmed === null
                ? undefined
                : "Not confirmed. Refresh the review policy to see what is saved."
            }
            icon="check"
            value={unconfirmed ?? policy.data.reviewBypassEnabled}
            disabled={busy || unconfirmed !== null}
            onChange={(reviewBypassEnabled) => {
              const current = policy.data;
              if (!current) return;
              confirm(
                reviewBypassEnabled
                  ? "Apply eligible work without review?"
                  : "Send eligible work to Reviews?",
                reviewBypassEnabled
                  ? "Agents that hold an execute permission will act without waiting in Reviews. That includes Finance approvals and account changes, sending mail, and syncing or disconnecting sources. Questions and required approvals still apply."
                  : "Eligible work will wait in Reviews until you decide.",
                () => save(current.version, reviewBypassEnabled),
              );
            }}
          />
        ) : (
          <State
            loading={policy.isPending}
            retry={policy.isError ? () => void refreshPolicy() : undefined}
          />
        )}
      </Section>
      <SectionFootnote>
        Off by default: eligible work waits in Reviews until you decide. When on, an agent that also
        holds an execute permission can act without review: Finance approvals, account changes and
        settings, sending mail and activating mail rules, changing workspace and notification
        settings, and syncing or disconnecting sources. Questions and required approvals still
        apply.
      </SectionFootnote>
      <Section>
        <SettingsActionRow
          label="Refresh review policy"
          icon="refresh"
          disabled={action.pending || policyRefresh.pending}
          onPress={() => void refreshPolicy()}
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
                    setScopes((current) => toggleScope(current, scope, selected))
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
