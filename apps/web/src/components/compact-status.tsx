import { useState } from "react";
import type { Icon } from "./icons";
import { Badge } from "./ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";

/** Short status labels retain a readable equivalent for touch and keyboard users. */
export function CompactStatus({ label, icon: Icon }: { label: string; icon: Icon }) {
  const [open, setOpen] = useState(false);
  return (
    <TooltipProvider>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <Badge
            asChild
            variant="secondary"
            className="relative size-5 px-0 after:absolute after:-inset-2"
          >
            <button type="button" aria-label={label} onClick={() => setOpen(!open)}>
              <Icon aria-hidden="true" />
              <span className="sr-only">{label}</span>
            </button>
          </Badge>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
