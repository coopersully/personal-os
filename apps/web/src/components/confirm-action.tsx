import { useCallback, useRef, useState } from "react";
import { Button } from "./ui/button.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.js";

type ConfirmationOptions = {
  title: string;
  description: string;
  actionLabel: string;
  onConfirm: () => void;
  returnFocus?: HTMLElement | null;
};

/** The caller owns the mutation and its eventual outcome feedback. */
export function useConfirmAction() {
  const [options, setOptions] = useState<ConfirmationOptions | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const invoker = useRef<HTMLElement | null>(null);
  const menuTrigger = useRef<HTMLElement | null>(null);
  const action = useRef<(() => void) | null>(null);

  const confirm = useCallback((next: ConfirmationOptions) => {
    const active = document.activeElement;
    invoker.current = active instanceof HTMLElement ? active : null;
    // Menu commands disappear on selection; return to their surviving trigger.
    const triggerId = invoker.current?.closest('[role="menu"]')?.getAttribute("aria-labelledby");
    menuTrigger.current =
      next.returnFocus ??
      (triggerId ? document.getElementById(triggerId) : null) ??
      document.querySelector<HTMLElement>('[data-slot="context-menu-trigger"][data-state="open"]');
    action.current = next.onConfirm;
    setOptions(next);
  }, []);

  const dismiss = () => {
    action.current = null;
    setOptions(null);
  };

  return {
    confirm,
    confirmation: (
      <Dialog open={options !== null} onOpenChange={(open) => !open && dismiss()}>
        {options ? (
          <DialogContent
            showCloseButton={false}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              cancel.current?.focus();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const target = menuTrigger.current?.isConnected
                ? menuTrigger.current
                : invoker.current;
              target?.focus();
            }}
          >
            <DialogHeader>
              <DialogTitle>{options.title}</DialogTitle>
              <DialogDescription>{options.description}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button ref={cancel} type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  const execute = action.current;
                  dismiss();
                  execute?.();
                }}
              >
                {options.actionLabel}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    ),
  };
}
