import { type ReactNode, useCallback, useEffect, useState } from "react";
import {
  ResponsiveDialog,
  ResponsiveDialogActions,
  ResponsiveDialogBody,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";

type ProviderConnectionStepProps = {
  accountCount: number;
  children: ReactNode;
  confirmation: string;
  confirmLabel: string;
  continueSetup: () => void;
  registerContinue: (handler: () => void) => void;
};

export function ProviderConnectionStep({
  accountCount,
  children,
  confirmation,
  confirmLabel,
  continueSetup,
  registerContinue,
}: ProviderConnectionStepProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const requestContinue = useCallback(() => {
    if (accountCount > 0) continueSetup();
    else setConfirmOpen(true);
  }, [accountCount, continueSetup]);

  useEffect(() => registerContinue(requestContinue), [registerContinue, requestContinue]);

  return (
    <>
      {children}
      <ResponsiveDialog onOpenChange={setConfirmOpen} open={confirmOpen}>
        <ResponsiveDialogContent showCloseButton={false}>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{confirmation}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              You can connect one later in Settings.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody />
          <ResponsiveDialogFooter>
            <ResponsiveDialogActions>
              <ResponsiveDialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </ResponsiveDialogClose>
              <Button
                onClick={() => {
                  setConfirmOpen(false);
                  continueSetup();
                }}
              >
                {confirmLabel}
              </Button>
            </ResponsiveDialogActions>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
