import type {
  AgentAccount,
  AgentAccountConnection,
  AgentAccountDirectory,
} from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { AgentIdentity, agentPlatformLabels } from "@/components/agent-identity";
import { DataViewLoading, DataViewRecovery } from "@/components/data-view-state";
import { Field, FieldGroup, FieldLabel } from "@/components/settings-field";
import { SettingsSelect } from "@/components/settings-select";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "../../api.js";
import { SettingsFeedbackContext } from "../../lib/settings-feedback.js";
import {
  type PreferenceSession,
  sameSession,
  usePreferenceSession,
} from "../workspace-settings/account-save-session";
import { boundAgentAccountIds, useAgentAccountDirectory } from "./agent-account-query";
import { ProfileSection } from "./profile-rows";

export function AgentAccountsSettings() {
  const cache = useQueryClient();
  const session = usePreferenceSession(cache);
  return <SessionAgentAccounts key={`${session.owner}:${session.epoch}`} session={session} />;
}

function SessionAgentAccounts({ session }: { session: PreferenceSession }) {
  const cache = useQueryClient();
  const [editing, setEditing] = useState<AgentAccount | null>(null);
  const [linking, setLinking] = useState<AgentAccountConnection | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const queryKey = ["agent-accounts", session.owner, session.epoch];
  const directory = useAgentAccountDirectory();
  const boundIds = directory.data ? boundAgentAccountIds(directory.data) : new Set<string>();
  const previous = directory.data?.accounts.filter((account) => !boundIds.has(account.id)) ?? [];
  const renderAccount = (account: AgentAccount) => {
    const connectionCount =
      directory.data?.connections.filter((connection) => connection.agentAccountId === account.id)
        .length ?? 0;
    return (
      <div key={account.id} className="flex min-w-0 items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <AgentIdentity account={account} />
          <p className="mt-1 text-xs text-muted-foreground">
            {connectionCount} {connectionCount === 1 ? "connection" : "connections"}
          </p>
        </div>
        <Button
          variant="ghost"
          onClick={() => setEditing(account)}
          aria-label={`Edit agent account ${account.displayName}`}
        >
          Edit
        </Button>
      </div>
    );
  };
  async function perform(action: () => Promise<unknown>, message: string) {
    if (busy.current || !sameSession(cache, session)) return;
    busy.current = true;
    setPending(true);
    const notice = toast.loading("Saving agent account…");
    try {
      await action();
      if (!sameSession(cache, session)) {
        toast.dismiss(notice);
        return;
      }
      // Finance Activity reads directly on each route mount; it has no query cache to invalidate.
      await Promise.all([
        cache.invalidateQueries({ queryKey }),
        cache.invalidateQueries({ queryKey: ["finance-host-schedules"] }),
        cache.invalidateQueries({ queryKey: ["finance-host-connections"] }),
      ]);
      if (!sameSession(cache, session)) {
        toast.dismiss(notice);
        return;
      }
      setEditing(null);
      setLinking(null);
      toast.success(message, { id: notice });
    } catch (error) {
      if (sameSession(cache, session)) {
        toast.error(error instanceof Error ? error.message : "Could not save the agent account.", {
          id: notice,
        });
      } else toast.dismiss(notice);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <SettingsFeedbackContext.Provider value={true}>
      <ProfileSection
        title={directory.isSuccess ? `Agent Accounts · ${boundIds.size}` : "Agent Accounts"}
      >
        <DataViewRecovery
          query={directory}
          title="Couldn’t load agent accounts."
          unavailableLabel="Agent accounts unavailable"
        />
        {directory.isPending && session.owner ? (
          <DataViewLoading label="Loading agent accounts" />
        ) : null}
        {directory.isSuccess && directory.data.accounts.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            Agent accounts appear when an agent connects.
          </p>
        ) : null}
        {directory.data?.accounts.filter((account) => boundIds.has(account.id)).map(renderAccount)}
        {previous.length ? (
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="mx-4">
                Previous accounts · {previous.length}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>{previous.map(renderAccount)}</CollapsibleContent>
          </Collapsible>
        ) : null}
        {directory.data?.connections.map((connection) => {
          const account = directory.data.accounts.find(
            (item) => item.id === connection.agentAccountId,
          );
          return (
            <div
              key={connection.id}
              className="flex min-w-0 items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate">{connection.label}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {account?.displayName ?? "No agent account"} ·{" "}
                  {connection.active ? "Active connection" : "Inactive connection"}
                </p>
              </div>
              <Button
                variant="ghost"
                onClick={() => setLinking(connection)}
                aria-label={`Change account for ${connection.label}`}
              >
                Change
              </Button>
            </div>
          );
        })}
      </ProfileSection>
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit agent account</DialogTitle>
            <DialogDescription>
              This identity is shared across workspaces. Permissions stay with each connection.
            </DialogDescription>
          </DialogHeader>
          {editing ? (
            <AccountForm
              key={editing.id}
              account={editing}
              pending={pending}
              save={(patch) =>
                perform(() => api.updateAgentAccount(editing.id, patch), "Agent account saved.")
              }
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!linking}
        onOpenChange={(open) => {
          if (!open) setLinking(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change connection account</DialogTitle>
            <DialogDescription>
              Choose the identity for this connection. Its permissions and revocation remain
              separate.
            </DialogDescription>
          </DialogHeader>
          {linking && directory.data ? (
            <ConnectionForm
              key={linking.id}
              connection={linking}
              directory={directory.data}
              pending={pending}
              save={(agentAccountId) =>
                perform(
                  () => api.linkAgentAccountConnection(linking.id, { agentAccountId }),
                  "Connection account saved.",
                )
              }
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </SettingsFeedbackContext.Provider>
  );
}

function AccountForm({
  account,
  pending,
  save,
}: {
  account: AgentAccount;
  pending: boolean;
  save: (patch: Pick<AgentAccount, "displayName" | "accountLabel" | "platform">) => Promise<void>;
}) {
  const [name, setName] = useState(account.displayName);
  const [label, setLabel] = useState(account.accountLabel ?? "");
  const [platform, setPlatform] = useState(account.platform);
  const dirty =
    name.trim() !== account.displayName ||
    (label.trim() || null) !== account.accountLabel ||
    platform !== account.platform;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (dirty && name.trim())
          void save({ displayName: name.trim(), accountLabel: label.trim() || null, platform });
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="agent-account-name">Display name</FieldLabel>
          <Input
            id="agent-account-name"
            maxLength={80}
            disabled={pending}
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="agent-account-label">Account label</FieldLabel>
          <Input
            id="agent-account-label"
            maxLength={80}
            disabled={pending}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="agent-account-platform">Platform</FieldLabel>
          <SettingsSelect
            id="agent-account-platform"
            disabled={pending}
            value={platform}
            onChange={(event) => setPlatform(event.target.value as AgentAccount["platform"])}
          >
            {Object.entries(agentPlatformLabels).map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </SettingsSelect>
        </Field>
        <Button disabled={pending || !dirty || !name.trim()}>Save account</Button>
      </FieldGroup>
    </form>
  );
}

function ConnectionForm({
  connection,
  directory,
  pending,
  save,
}: {
  connection: AgentAccountConnection;
  directory: AgentAccountDirectory;
  pending: boolean;
  save: (id: string | null) => Promise<void>;
}) {
  const [selected, setSelected] = useState(connection.agentAccountId ?? "");
  const currentPlatform =
    directory.accounts.find((account) => account.id === connection.agentAccountId)?.platform ??
    "unknown";
  const compatibleAccounts = directory.accounts.filter(
    (account) =>
      currentPlatform === "unknown" ||
      account.platform === "unknown" ||
      account.platform === currentPlatform,
  );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (selected) void save(selected === "new" ? null : selected);
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="connection-agent-account">Agent account</FieldLabel>
          <SettingsSelect
            id="connection-agent-account"
            disabled={pending}
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="" disabled>
              Choose an account
            </option>
            {compatibleAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.displayName} · {agentPlatformLabels[account.platform]}
                {account.accountLabel ? ` · ${account.accountLabel}` : ""}
              </option>
            ))}
            <option value="new">Create a new agent account</option>
          </SettingsSelect>
        </Field>
        <Button disabled={pending || !selected || selected === connection.agentAccountId}>
          Save connection account
        </Button>
      </FieldGroup>
    </form>
  );
}
