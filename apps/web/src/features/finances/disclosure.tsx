import { type ReactNode, useState } from "react";
import { ChevronDownIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

/** Quiet, consistently sized evidence disclosure; retains content for accessible state inspection. */
export function FinanceDisclosure({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="group/finance-disclosure min-w-0">
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className="min-h-11 w-full justify-between whitespace-normal text-left"
        >
          {title}
          <ChevronDownIcon className="shrink-0 transition-transform group-data-[state=open]/finance-disclosure:rotate-180" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent
        forceMount
        hidden={!open}
        className="flex min-w-0 flex-col gap-3 px-3 pb-3 text-sm data-[state=closed]:hidden"
      >
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
