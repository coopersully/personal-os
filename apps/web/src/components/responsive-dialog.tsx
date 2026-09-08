import * as React from "react";
import { XIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

const ResponsiveDialogContext = React.createContext<{ isMobile: boolean } | null>(null);

function useResponsiveDialog() {
  const context = React.useContext(ResponsiveDialogContext);
  if (!context) {
    throw new Error("Responsive dialog slots must be used within ResponsiveDialog.");
  }
  return context;
}

type ResponsiveDialogProps = React.ComponentProps<typeof Dialog> & {
  dismissible?: boolean;
};

function ResponsiveDialog({
  children,
  defaultOpen = false,
  dismissible = true,
  onOpenChange,
  open,
  ...props
}: ResponsiveDialogProps) {
  const isMobile = useIsMobile();
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const resolvedOpen = open ?? uncontrolledOpen;
  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (open === undefined) setUncontrolledOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [onOpenChange, open],
  );

  return (
    <ResponsiveDialogContext.Provider value={{ isMobile }}>
      {isMobile ? (
        <Drawer
          dismissible={dismissible}
          onOpenChange={handleOpenChange}
          open={resolvedOpen}
          {...props}
        >
          {children}
        </Drawer>
      ) : (
        <Dialog onOpenChange={handleOpenChange} open={resolvedOpen} {...props}>
          {children}
        </Dialog>
      )}
    </ResponsiveDialogContext.Provider>
  );
}

function ResponsiveDialogTrigger(props: React.ComponentProps<typeof DialogTrigger>) {
  const { isMobile } = useResponsiveDialog();
  return isMobile ? <DrawerTrigger {...props} /> : <DialogTrigger {...props} />;
}

function ResponsiveDialogClose(props: React.ComponentProps<typeof DialogClose>) {
  const { isMobile } = useResponsiveDialog();
  return isMobile ? <DrawerClose {...props} /> : <DialogClose {...props} />;
}

function ResponsiveDialogContent({
  children,
  className,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogContent>) {
  const { isMobile } = useResponsiveDialog();

  if (!isMobile) {
    return (
      <DialogContent
        className={cn("max-h-[calc(100dvh-2rem)] overflow-hidden", className)}
        data-presentation="dialog"
        data-responsive-slot="content"
        showCloseButton={showCloseButton}
        {...props}
      >
        {children}
      </DialogContent>
    );
  }

  return (
    <DrawerContent
      className={cn(
        "max-h-[calc(100dvh-1rem)] border-transparent pb-[env(safe-area-inset-bottom)]",
        className,
      )}
      data-presentation="drawer"
      data-responsive-slot="content"
      {...props}
    >
      {children}
      {showCloseButton ? (
        <DrawerClose asChild>
          <Button className="absolute top-3 right-3" size="icon-sm" variant="ghost">
            <XIcon />
            <span className="sr-only">Close</span>
          </Button>
        </DrawerClose>
      ) : null}
    </DrawerContent>
  );
}

function ResponsiveDialogHeader({
  className,
  ...props
}: React.ComponentProps<typeof DialogHeader>) {
  const { isMobile } = useResponsiveDialog();
  return isMobile ? (
    <DrawerHeader className={className} data-responsive-slot="header" {...props} />
  ) : (
    <DialogHeader className={className} data-responsive-slot="header" {...props} />
  );
}

function ResponsiveDialogBody({ className, ...props }: React.ComponentProps<"div">) {
  const { isMobile } = useResponsiveDialog();
  return (
    <div
      className={cn("min-h-0 overflow-y-auto", isMobile && "px-4 pb-2", className)}
      data-responsive-slot="body"
      {...props}
    />
  );
}

function ResponsiveDialogFooter({
  className,
  ...props
}: React.ComponentProps<typeof DialogFooter>) {
  const { isMobile } = useResponsiveDialog();
  return isMobile ? (
    <DrawerFooter className={className} data-responsive-slot="footer" {...props} />
  ) : (
    <DialogFooter className={className} data-responsive-slot="footer" {...props} />
  );
}

function ResponsiveDialogActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      data-responsive-slot="actions"
      {...props}
    />
  );
}

function ResponsiveDialogTitle(props: React.ComponentProps<typeof DialogTitle>) {
  const { isMobile } = useResponsiveDialog();
  return isMobile ? <DrawerTitle {...props} /> : <DialogTitle {...props} />;
}

function ResponsiveDialogDescription(props: React.ComponentProps<typeof DialogDescription>) {
  const { isMobile } = useResponsiveDialog();
  return isMobile ? <DrawerDescription {...props} /> : <DialogDescription {...props} />;
}

export {
  ResponsiveDialog,
  ResponsiveDialogActions,
  ResponsiveDialogBody,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
};
