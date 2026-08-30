import { type ReactNode, useState } from "react";
import { ChevronDownIcon, CircleAlertIcon, CircleCheckIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export type ReadinessPanelCheck = {
  action?: ReactNode;
  complete: boolean;
  description: ReactNode;
  id: string;
  title: ReactNode;
};

export type ReadinessPanelFocus = {
  label: "Current constraint" | "Next step";
  title: ReactNode;
};

type ReadinessPanelProps = {
  checks: ReadonlyArray<ReadinessPanelCheck>;
  className?: string;
  description: ReactNode;
  detailsLabel: string;
  focus?: ReadinessPanelFocus;
  icon: ReactNode;
  loading?: boolean;
  title: ReactNode;
  unavailable?: boolean;
};

/**
 * A determinate readiness summary with progressive diagnostic disclosure.
 * Loading and unavailable states never render a completion percentage.
 */
export function ReadinessPanel({
  checks,
  className,
  description,
  detailsLabel,
  focus,
  icon,
  loading = false,
  title,
  unavailable = false,
}: ReadinessPanelProps) {
  const [completedOpen, setCompletedOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const completeCount = checks.filter((check) => check.complete).length;
  const completedChecks = checks.filter((check) => check.complete);
  const unresolvedChecks = checks.filter((check) => !check.complete);
  const determinate = !loading && !unavailable && checks.length > 0;
  const complete = determinate && completeCount === checks.length;
  const progressText = `${completeCount} of ${checks.length} complete`;
  const progressLabel = `${completeCount} of ${checks.length} checks complete`;
  const status = unavailable
    ? "Unavailable"
    : loading
      ? "Checking"
      : complete
        ? "Ready"
        : `${unresolvedChecks.length} to finish`;

  return (
    <Item className={cn("items-start overflow-hidden", className)} size="default" variant="outline">
      <ItemMedia className="text-muted-foreground" variant="icon">
        {icon}
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{title}</ItemTitle>
        <ItemDescription className="line-clamp-1">
          {determinate && !complete && focus ? (
            <>
              <strong>{focus.label}:</strong> {focus.title}
            </>
          ) : (
            description
          )}
        </ItemDescription>
      </ItemContent>
      <ItemActions className="ml-auto">
        <Badge variant={complete ? "default" : "secondary"}>{status}</Badge>
      </ItemActions>

      {determinate || checks.length > 0 ? (
        <ItemFooter className="gap-3">
          {determinate ? (
            <div
              className="flex min-w-0 flex-1 flex-col gap-1.5"
              data-slot="readiness-panel-progress"
            >
              <span className="text-xs text-muted-foreground tabular-nums">{progressText}</span>
              <Progress
                aria-label={progressLabel}
                value={Math.round((completeCount / checks.length) * 100)}
              />
            </div>
          ) : (
            <span className="flex-1" />
          )}
          {checks.length > 0 ? (
            <Dialog
              onOpenChange={(open) => {
                setDetailsOpen(open);
                if (!open) setCompletedOpen(false);
              }}
              open={detailsOpen}
            >
              <DialogTrigger asChild>
                <Button className="shrink-0" size="sm" type="button" variant="ghost">
                  Review checks
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>{detailsLabel}</DialogTitle>
                  <DialogDescription>
                    {determinate
                      ? readinessDialogSummary(unresolvedChecks.length, completeCount)
                      : "Review the available checks."}
                  </DialogDescription>
                </DialogHeader>
                {unresolvedChecks.length > 0 ? (
                  <ItemGroup aria-label={`${detailsLabel}: not ready`} className="gap-2.5">
                    {unresolvedChecks.map((check) => (
                      <Item key={check.id} role="listitem" size="sm" variant="outline">
                        <ItemMedia variant="icon">
                          <CircleAlertIcon aria-hidden="true" />
                        </ItemMedia>
                        <ItemContent>
                          <ItemTitle>{check.title}</ItemTitle>
                          <ItemDescription className="line-clamp-none">
                            {check.description}
                          </ItemDescription>
                        </ItemContent>
                        {check.action ? <ItemActions>{check.action}</ItemActions> : null}
                      </Item>
                    ))}
                  </ItemGroup>
                ) : null}
                {completedChecks.length > 0 ? (
                  <Collapsible onOpenChange={setCompletedOpen} open={completedOpen}>
                    <CollapsibleTrigger asChild>
                      <Button className="w-full justify-between" size="sm" variant="ghost">
                        {`${completedOpen ? "Hide" : "Show"} ${completedChecks.length} completed ${completedChecks.length === 1 ? "check" : "checks"}`}
                        <ChevronDownIcon data-icon="inline-end" />
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <ItemGroup aria-label={`${detailsLabel}: completed`} className="mt-2 gap-2">
                        {completedChecks.map((check) => (
                          <Item key={check.id} role="listitem" size="xs" variant="muted">
                            <ItemMedia variant="icon">
                              <CircleCheckIcon aria-hidden="true" />
                            </ItemMedia>
                            <ItemContent>
                              <ItemTitle>{check.title}</ItemTitle>
                              <ItemDescription className="line-clamp-1">
                                {check.description}
                              </ItemDescription>
                            </ItemContent>
                          </Item>
                        ))}
                      </ItemGroup>
                    </CollapsibleContent>
                  </Collapsible>
                ) : null}
              </DialogContent>
            </Dialog>
          ) : null}
        </ItemFooter>
      ) : null}
    </Item>
  );
}

function readinessDialogSummary(unresolvedCount: number, completedCount: number): string {
  const unresolved = `${unresolvedCount} ${unresolvedCount === 1 ? "check needs" : "checks need"} attention.`;
  const completed = `${completedCount} completed.`;
  return unresolvedCount > 0 ? `${unresolved} ${completed}` : completed;
}
