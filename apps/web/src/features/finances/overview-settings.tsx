import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api";
import { QueryFeedback } from "@/components/async-state";
import { Button } from "@/components/ui/button";
import { sameSession, usePreferenceSession } from "../workspace-settings/account-save-session";
import {
  useSaveWorkspacePreferences,
  useWorkspacePreferences,
} from "../workspace-settings/preferences";
import {
  preferenceValueLabel,
  WorkspacePreferenceRecovery,
} from "../workspace-settings/save-recovery";
import {
  type FinanceAccountScope,
  financeAccountPreferenceKeys,
  selectedFinanceAccounts,
} from "./account-preferences";
import { AccountScopeDialog } from "./account-scope-dialog";

export function FinanceOverviewSettings() {
  const cache = useQueryClient();
  const session = usePreferenceSession(cache);
  return <OverviewSettings key={`${session.owner}:${session.epoch}`} />;
}
function OverviewSettings() {
  const cache = useQueryClient();
  const session = usePreferenceSession(cache);
  const [expanded, setExpanded] = useState(false);
  const [scope, setScope] = useState<FinanceAccountScope | null>(null);
  const preferences = useWorkspacePreferences("finances");
  const save = useSaveWorkspacePreferences("finances");
  const recoveryScope = (
    Object.keys(financeAccountPreferenceKeys) as Array<keyof typeof financeAccountPreferenceKeys>
  ).find(
    (scope) => save.recovery && financeAccountPreferenceKeys[scope] in save.recovery.attempted,
  );
  const configuration = useQuery({
    queryKey: ["finance-view-configuration", session.owner, session.epoch],
    enabled: !!session.owner && (expanded || !!save.recovery),
    queryFn: async () => {
      const result = await api.getFinanceConfiguration();
      if (!sameSession(cache, session)) throw new Error("Account session changed.");
      return result;
    },
  });
  const accounts =
    configuration.data?.accounts.state === "loaded"
      ? configuration.data.accounts.value.accounts
      : undefined;
  const formatValue = (value: unknown, key: string) =>
    Array.isArray(value) && key.endsWith("AccountIds")
      ? value.length
        ? value
            .map(
              (id) => accounts?.find((account) => account.id === id)?.name ?? "Unavailable account",
            )
            .join(", ")
        : "None selected"
      : preferenceValueLabel(value, key);
  const recovery = (
    <WorkspacePreferenceRecovery
      workspace="finances"
      formatValue={formatValue}
      unavailable={!!recoveryScope && !accounts}
    />
  );
  const disabled =
    !accounts || !preferences.isSuccess || save.isWorkspacePending || !!save.recovery;
  return (
    <section aria-label="Finance workspace view settings">
      <Button
        type="button"
        variant="outline"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        Workspace view settings
      </Button>
      {expanded || save.recovery ? (
        <div className="flex flex-col gap-3 pt-3">
          <p className="text-sm text-muted-foreground">
            Saved account display selections do not change the financial position totals shown here,
            planning inclusion, or account meanings.
          </p>
          <QueryFeedback
            query={configuration}
            title="Couldn’t load account names for view settings."
          />
          <QueryFeedback query={preferences} title="Couldn’t load saved account selections." />
          {configuration.isSuccess && !accounts ? (
            <>
              <p>
                Account names are unavailable. Reload them before editing or reapplying account
                selections.
              </p>
              <Button
                type="button"
                variant="secondary"
                disabled={configuration.isFetching}
                onClick={() => void configuration.refetch()}
              >
                Reload account names
              </Button>
            </>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {(["spend", "cash", "investments"] as const).map((value) => (
              <Button
                key={value}
                type="button"
                variant="secondary"
                disabled={disabled}
                onClick={() => setScope(value)}
              >
                {value === "spend" ? "Spending" : value === "cash" ? "Cash" : "Investment"} account
                view selections
              </Button>
            ))}
            {recoveryScope ? (
              <Button type="button" variant="secondary" onClick={() => setScope(recoveryScope)}>
                Review unsaved account selections
              </Button>
            ) : null}
            <Button asChild variant="outline">
              <Link to="/settings?section=finances">Open Finance settings</Link>
            </Button>
          </div>
          {!scope ? recovery : null}
        </div>
      ) : null}
      <AccountScopeDialog
        viewOnly
        accounts={accounts ?? []}
        disabled={disabled}
        feedback={recovery}
        scope={scope}
        selectedIds={
          scope ? selectedFinanceAccounts(accounts ?? [], scope, preferences.data?.preferences) : []
        }
        onOpenChange={(open) => !open && setScope(null)}
        onReset={(value) => save.mutate({ [financeAccountPreferenceKeys[value]]: null })}
        onChange={(value, id, checked) =>
          save.mutate((current) => {
            const selected = selectedFinanceAccounts(accounts ?? [], value, current);
            return {
              [financeAccountPreferenceKeys[value]]: checked
                ? [...new Set([...selected, id])]
                : selected.filter((selectedId) => selectedId !== id),
            };
          })
        }
      />
    </section>
  );
}
