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
  const [step, setStep] = useState<"choose" | "account" | "manual" | null>(null);
  return (
    <>
      <Button
        aria-label={
          kind === "account"
            ? "Add account"
            : kind === "transaction"
              ? "Add transaction"
              : "Add in Finances"
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
          setStep(kind === "account" ? "account" : "choose");
        }}
      >
        <PlusIcon aria-hidden="true" />
      </Button>
      {step === "manual" ? (
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
                  <Button variant="outline" onClick={() => setStep("manual")}>
                    Track account manually
                  </Button>
                </>
              ) : (
                <>
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
            {step === "account" && !kind ? (
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
