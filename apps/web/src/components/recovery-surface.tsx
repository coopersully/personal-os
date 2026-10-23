import { type ReactNode, useRef } from "react";
import { useIsMobile } from "../hooks/use-mobile";
import { ModalRecoveryPriority } from "./modal-recovery-priority";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "./ui/drawer";

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
  const mobile = useIsMobile();
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
  const content = mobile ? (
    <Drawer open={open} dismissible={false} shouldScaleBackground={false} autoFocus>
      <DrawerContent className="overflow-hidden" {...focus}>
        <DrawerHeader className="shrink-0">
          <DrawerTitle>{title}</DrawerTitle>
          <DrawerDescription>{description}</DrawerDescription>
        </DrawerHeader>
        {children ? <div className="min-h-0 overflow-y-auto px-4">{children}</div> : null}
        <DrawerFooter className="grid shrink-0 grid-cols-1 sm:grid-cols-2">{actions}</DrawerFooter>
      </DrawerContent>
    </Drawer>
  ) : (
    <Dialog open={open}>
      <DialogContent
        className={
          children ? "max-h-[85svh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden" : ""
        }
        showCloseButton={false}
        {...focus}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children ? <div className="min-h-0 overflow-y-auto">{children}</div> : null}
        <DialogFooter>{actions}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
  return <ModalRecoveryPriority.Provider value={false}>{content}</ModalRecoveryPriority.Provider>;
}
