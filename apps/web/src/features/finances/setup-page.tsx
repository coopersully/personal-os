import { useMutationState, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "../../api.js";
import { MutationFeedback } from "../../components/mutation-feedback.js";
import { useFeedbackMutation } from "../../lib/use-feedback-mutation.js";
import { SettingsSection } from "../settings/settings-layout.js";
import { FinanceConfigurationEditor } from "./configuration-editor.js";
import { requireFinanceResult } from "./position-material.js";
import { SetupMaintenance } from "./setup-maintenance.js";
import { financeConfigurationKey, useFinanceConfiguration } from "./use-finance-configuration.js";

export function FinanceSetupPage() {
  const query = useFinanceConfiguration();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const selected = params.get("section") ?? "profile";
  const section = ["profile", "accounts", "budget"].includes(selected) ? selected : "profile";
  const returnTo = params.get("returnTo");
  const safeReturn = returnTo && /^\/finances(?:[/?#]|$)/.test(returnTo) ? returnTo : null;
  const pendingSaves = useMutationState({
    filters: { status: "pending" },
    select: (mutation) => mutation.options.scope?.id === "finance-profile-configuration",
  }).some(Boolean);
  const generate = useFeedbackMutation({
    feedback: { action: "prepare your budget", safeToRetry: false, form: true },
    mutationFn: async () =>
      requireFinanceResult(await api.setupFinances({ operation: "prepare_budget" })),
    onSuccess: () => client.invalidateQueries({ queryKey: financeConfigurationKey }),
  });
  const profile = query.data?.profile;
  const accounts = query.data?.accounts;
  const budget = query.data?.budget;
  const execution = query.data?.execution;
  const run = execution?.state === "loaded" ? execution.value : null;
  const status = {
    profile:
      profile?.state === "loaded"
        ? profile.value
          ? "Editable"
          : "Not recorded"
        : query.isPending
          ? "Loading"
          : "Unavailable",
    accounts:
      accounts?.state === "loaded"
        ? `${accounts.value.accounts.length} accounts`
        : query.isPending
          ? "Loading"
          : "Unavailable",
    budget:
      budget?.state === "loaded"
        ? budget.value
          ? "Draft or saved budget"
          : "Not created"
        : query.isPending
          ? "Loading"
          : "Unavailable",
  };
  if (query.isError)
    return (
      <Alert>
        <AlertDescription>
          Financial profile could not load.{" "}
          <Button variant="secondary" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  return (
    <section className="grid gap-4" aria-label="Financial profile">
      <nav aria-label="Financial profile sections" className="grid gap-2 sm:grid-cols-3">
        {(
          [
            ["profile", "Profile"],
            ["accounts", "Accounts and records"],
            ["budget", "Budget"],
          ] as const
        ).map(([id, title]) => (
          <Button
            key={id}
            variant={section === id ? "secondary" : "ghost"}
            className={`h-auto justify-between gap-2 whitespace-normal p-3 ${section === id ? "bg-card" : ""}`}
            aria-current={section === id ? "page" : undefined}
            onClick={() =>
              setParams((current) => {
                const next = new URLSearchParams(current);
                next.set("section", id);
                return next;
              })
            }
          >
            {title}
            <span className="text-xs font-normal text-muted-foreground">{status[id]}</span>
          </Button>
        ))}
      </nav>
      {query.isPending ? (
        <p role="status">Loading financial setup…</p>
      ) : (
        <>
          {section === "profile" ? <FinanceConfigurationEditor /> : null}
          {section === "accounts" ? (
            <>
              <SettingsSection
                title="Accounts"
                action={
                  <Button asChild variant="secondary">
                    <Link to="/finances/accounts">Manage accounts</Link>
                  </Button>
                }
              >
                {accounts?.state === "loaded" ? (
                  accounts.value.accounts.length ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {accounts.value.accounts.map((account) => (
                        <div className="rounded-lg bg-secondary p-4" key={account.id}>
                          <p className="font-medium">{account.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {account.status === "needs_reauth"
                              ? "Reconnect required"
                              : account.status === "manual"
                                ? "Manual account"
                                : "Connected"}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Connect an account or add one manually. You can also import transactions.
                    </p>
                  )
                ) : (
                  <p role="alert">
                    Accounts could not load.{" "}
                    <Button variant="ghost" onClick={() => void query.refetch()}>
                      Retry
                    </Button>
                  </p>
                )}
                <Button asChild variant="ghost">
                  <Link to="/finances/imports">Import history</Link>
                </Button>
              </SettingsSection>
              <SettingsSection title="Check records">
                {execution?.state === "unavailable" ? (
                  <p role="alert">
                    Record-check progress could not load.{" "}
                    <Button onClick={() => void query.refetch()}>Retry</Button>
                  </p>
                ) : (
                  <>
                    {run ? (
                      <Badge variant="secondary">{run.status.replaceAll("_", " ")}</Badge>
                    ) : null}
                    <SetupMaintenance
                      nextAction={{
                        tool: "maintain_finances",
                        arguments:
                          run &&
                          !["completed", "completed_with_questions", "failed_terminal"].includes(
                            run.status,
                          )
                            ? { operation: "resume", runId: run.id }
                            : { operation: "start" },
                        reason: "Check your transaction evidence",
                      }}
                    />
                  </>
                )}
              </SettingsSection>
            </>
          ) : null}
          {section === "budget" ? (
            <SettingsSection title="Budget">
              {budget?.state === "unavailable" ? (
                <p role="alert">
                  Your budget could not load.{" "}
                  <Button variant="secondary" onClick={() => void query.refetch()}>
                    Retry
                  </Button>
                </p>
              ) : budget?.state === "loaded" && budget.value ? (
                <>
                  <p>
                    Your saved budget is available to inspect. Changes to your profile do not
                    approve or activate a revised budget.
                  </p>
                  <Button asChild className="self-start">
                    <Link to="/finances/plan">Open budget</Link>
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    Prepare a draft from the information you have recorded. Unknown amounts remain
                    unknown. Approval and financial evidence are checked separately.
                  </p>
                  <Button
                    className="self-start"
                    disabled={generate.isPending || pendingSaves || profile?.state !== "loaded"}
                    onClick={() => generate.mutate()}
                  >
                    {generate.isPending ? "Preparing budget…" : "Prepare budget"}
                  </Button>
                </>
              )}
              <MutationFeedback feedback={generate.feedback} />
              {generate.data?.communication.requiredDisclosures.map((item) => (
                <Alert key={item.message}>
                  <AlertDescription>{item.message}</AlertDescription>
                </Alert>
              ))}
            </SettingsSection>
          ) : null}
        </>
      )}
      {safeReturn ? (
        <Button asChild variant="ghost" className="justify-self-start">
          <Link to={safeReturn}>Return to previous page</Link>
        </Button>
      ) : null}
    </section>
  );
}
