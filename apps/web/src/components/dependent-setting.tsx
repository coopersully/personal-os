import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";

/** Keep dependent settings visible and explain the prerequisite to pointer and keyboard users. */
export function DependentSetting({ enabled, reason, children }: {
  enabled: boolean;
  reason: string;
  children: ReactNode;
}) {
  return <TooltipProvider><Tooltip><TooltipTrigger asChild>
    <div className="settings-dependent" data-disabled={!enabled || undefined} tabIndex={enabled ? undefined : 0} aria-label={enabled ? undefined : reason}>
      <fieldset disabled={!enabled} className="min-w-0 border-0 p-0">{children}</fieldset>
    </div>
  </TooltipTrigger>{!enabled ? <TooltipContent>{reason}</TooltipContent> : null}</Tooltip></TooltipProvider>;
}
