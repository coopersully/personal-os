import type { ReactNode } from "react";
import { ActionButton } from "@/components/action-button";
import { SettingsIcon } from "@/components/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useMediaQuery } from "@/hooks/use-media-query";

/** Infrequent page controls share one mobile target; search stays mounted outside it. */
export function WorkspaceHeaderOptions({ children }: { children: ReactNode }) {
  const compact = useMediaQuery("(max-width: 767px)");
  if (!compact) return <div className="workspace-header-options">{children}</div>;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <ActionButton aria-label="View options" size="icon" variant="ghost">
          <SettingsIcon />
        </ActionButton>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="workspace-header-options w-auto max-w-[calc(100vw-2rem)]"
        aria-label="View options"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
