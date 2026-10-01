import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Shared visual shell; the workspace owns placement and the opened workflow. */
export function FloatingActions({ className, ...props }: ComponentProps<"nav">) {
  return <nav className={cn("floating-actions", className)} {...props} />;
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
