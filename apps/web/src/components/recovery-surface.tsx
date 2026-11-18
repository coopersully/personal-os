import { type ReactNode, useRef } from "react";
import { ModalRecoveryPriority } from "./modal-recovery-priority";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "./responsive-dialog";

/** Recovery always requires an explicit action; backdrop, Escape and swipe never dismiss it. */
export function RecoverySurface({
  open,
  title,
  description,
  children,
  actions,
}: {
  open: boolean;
  title: string;
  description: string;
  children?: ReactNode;
  actions: ReactNode;
}) {
  const previousFocus = useRef<HTMLElement | null>(null);
  const focus = {
    onOpenAutoFocus: () => {
      previousFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    },
    onCloseAutoFocus: (event: Event) => {
      if (previousFocus.current?.isConnected) {
        event.preventDefault();
        previousFocus.current.focus();
      }
    },
    onEscapeKeyDown: (event: KeyboardEvent) => event.preventDefault(),
    onInteractOutside: (event: Event) => event.preventDefault(),
  };
  const content = (
    <ResponsiveDialog open={open} dismissible={false}>
      <ResponsiveDialogContent showCloseButton={false} {...focus}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{description}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {children ? <ResponsiveDialogBody>{children}</ResponsiveDialogBody> : null}
        <ResponsiveDialogFooter>{actions}</ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
  return <ModalRecoveryPriority.Provider value={false}>{content}</ModalRecoveryPriority.Provider>;
}
