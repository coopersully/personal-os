import { AnimatePresence, type HTMLMotionProps, useIsPresent, usePresenceData } from "motion/react";
import * as m from "motion/react-m";
import { type ComponentProps, forwardRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Shared visual shell; the workspace owns placement and the opened workflow. */
export function FloatingActions({ className, ...props }: ComponentProps<"nav">) {
  return <nav className={cn("floating-actions", className)} {...props} />;
}

/** Stable anchor for domain-owned floating workflows; opening never changes their host. */
export function FloatingActionRegion({
  align,
  className,
  ...props
}: ComponentProps<"div"> & { align: "center" | "end" }) {
  return <div {...props} className={cn("floating-action-region", className)} data-align={align} />;
}

export function FloatingActionButton({
  label,
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, "aria-label" | "size" | "variant"> & { label: string }) {
  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            {...props}
            aria-label={label}
            className={cn("floating-actions__button", className)}
            size="icon"
            variant="ghost"
          />
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={8}>
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Shared anchored expansion for mobile action menus and Calendar workflows. */
export function FloatingActionSurface({
  state,
  contentKey = state,
  contentClassName,
  children,
  ...props
}: HTMLMotionProps<"div"> & {
  state: string;
  contentKey?: string;
  contentClassName?: string;
  children: ReactNode;
}) {
  return (
    <m.div
      {...props}
      initial={false}
      layout
      layoutDependency={contentKey}
      style={{ ...props.style, overflow: "hidden", position: "relative" }}
      transition={{ layout: { bounce: 0.12, duration: 0.38, type: "spring" } }}
    >
      <AnimatePresence custom={state} initial={false} mode="popLayout">
        <FloatingSurfaceContent key={contentKey} className={contentClassName}>
          {children}
        </FloatingSurfaceContent>
      </AnimatePresence>
    </m.div>
  );
}
const FloatingSurfaceContent = forwardRef<
  HTMLDivElement,
  { children: ReactNode; className?: string | undefined }
>(function FloatingSurfaceContent({ children, className }, ref) {
  const present = useIsPresent();
  const collapsing = usePresenceData() === "closed";
  return (
    <m.div
      ref={ref}
      className={className}
      aria-hidden={present ? undefined : true}
      inert={present ? undefined : true}
      initial={{ opacity: 0 }}
      animate={{
        opacity: 1,
        transition: {
          delay: collapsing && present ? 0.16 : 0,
          duration: 0.14,
          ease: [0.22, 1, 0.36, 1],
        },
      }}
      exit={{
        opacity: 0,
        transition: { duration: collapsing ? 0.24 : 0.12, ease: [0.4, 0, 1, 1] },
      }}
    >
      {children}
    </m.div>
  );
});
