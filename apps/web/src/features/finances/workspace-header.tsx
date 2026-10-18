import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ActionButton as Button } from "@/components/action-button";
import { ChevronRightIcon, PlusIcon, WalletIcon } from "@/components/icons";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { ManualAccountEditor } from "./accounts-page";
import { PlaidConnectButton } from "./plaid-connect";
import { refreshFinancePosition } from "./position-material";
import { useFinanceWorkspaceReadiness } from "./use-finance-workspace-readiness";

export function FinanceCreateButton({
  onSelect,
  kind,
}: {
  onSelect?: () => void;
  kind?: "account" | "transaction";
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const client = useQueryClient();
  const workspace = useFinanceWorkspaceReadiness();
  const task = new URLSearchParams(location.search).get("financeTask");
  const canCreateTransaction =
    workspace.manualCreationVisible === true &&
    !workspace.isError &&
    !workspace.isPending &&
    workspace.readiness?.workspaceAccessible === true &&
    !task;
  const canCreateManualAccount =
    workspace.manualCreationVisible === true && !workspace.isError && !workspace.isPending && !task;
  const [step, setStep] = useState<"choose" | "account" | "manual" | null>(null);
  if (task || (kind === "transaction" && !canCreateTransaction)) return null;
  return (
    <>
      <Button
        aria-label={
          kind === "account"
            ? "Add account"
            : kind === "transaction"
              ? "Add transaction"
              : canCreateTransaction
                ? "Add in Finances"
                : "Add account"
        }
        size="icon-sm"
        variant="ghost"
        onClick={() => {
          if (kind === "transaction") {
            navigate({
              pathname: "/finances/transactions",
              search: location.search,
              hash: "finance-add-transaction",
            });
            return;
          }
          setStep(kind === "account" || !canCreateTransaction ? "account" : "choose");
        }}
      >
        <PlusIcon aria-hidden="true" />
      </Button>
      {step === "manual" && canCreateManualAccount ? (
        <ManualAccountEditor onClose={() => setStep(null)} />
      ) : (
        <ResponsiveDialog open={step !== null} onOpenChange={(open) => !open && setStep(null)}>
          <ResponsiveDialogContent>
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>
                {step === "account"
                  ? "How would you like to add an account?"
                  : "What would you like to add?"}
              </ResponsiveDialogTitle>
            </ResponsiveDialogHeader>
            <ResponsiveDialogBody className="flex flex-col gap-3">
              {step === "account" ? (
                <>
                  <PlaidConnectButton
                    onConnected={async () => {
                      await refreshFinancePosition(client);
                      setStep(null);
                    }}
                  />
                  {canCreateManualAccount ? (
                    <Button variant="outline" onClick={() => setStep("manual")}>
                      Track account manually
                    </Button>
                  ) : null}
                </>
              ) : (
                <>
                  {canCreateTransaction ? (
                    <Button
                      className="h-auto justify-start gap-3 py-4"
                      variant="ghost"
                      onClick={() => {
                        setStep(null);
                        onSelect?.();
                        navigate({
                          pathname: "/finances/transactions",
                          search:
                            location.pathname === "/finances/transactions" ? location.search : "",
                          hash: "finance-add-transaction",
                        });
                      }}
                    >
                      <PlusIcon />
                      Transaction
                      <ChevronRightIcon className="ml-auto" />
                    </Button>
                  ) : null}
                  <Button
                    className="h-auto justify-start gap-3 py-4"
                    variant="ghost"
                    onClick={() => setStep("account")}
                  >
                    <WalletIcon />
                    Account
                    <ChevronRightIcon className="ml-auto" />
                  </Button>
                </>
              )}
            </ResponsiveDialogBody>
            {step === "account" && !kind && canCreateTransaction ? (
              <ResponsiveDialogFooter>
                <Button variant="ghost" onClick={() => setStep("choose")}>
                  Back
                </Button>
              </ResponsiveDialogFooter>
            ) : null}
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      )}
    </>
  );
}
