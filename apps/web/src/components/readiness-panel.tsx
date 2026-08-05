import { CheckCircle2, Circle } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  const completeCount = checks.filter((check) => check.complete).length;
  const determinate = !loading && !unavailable && checks.length > 0;
  const complete = determinate && completeCount === checks.length;
  const progressLabel = `${completeCount} of ${checks.length} checks ready`;
  const status = unavailable
    ? "Unavailable"
    : loading
      ? "Checking"
      : complete
        ? "Ready"
        : "Needs attention";

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
              <span className="text-xs text-muted-foreground tabular-nums">{progressLabel}</span>
              <Progress
                aria-label={progressLabel}
                value={Math.round((completeCount / checks.length) * 100)}
              />
            </div>
          ) : (
            <span className="flex-1" />
          )}
          {checks.length > 0 ? (
            <Dialog>
              <DialogTrigger asChild>
                <Button className="shrink-0" size="sm" type="button" variant="ghost">
                  View checks
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>{detailsLabel}</DialogTitle>
                  <DialogDescription>
                    {determinate
                      ? `${progressLabel}. Review the evidence behind this readiness state.`
                      : "Review the available evidence behind this readiness state."}
                  </DialogDescription>
                </DialogHeader>
                <ItemGroup aria-label={detailsLabel} className="gap-2.5">
                  {checks.map((check) => (
                    <Item key={check.id} role="listitem" size="sm" variant="muted">
                      <ItemMedia variant="icon">
                        {check.complete ? (
                          <CheckCircle2 aria-hidden="true" />
                        ) : (
                          <Circle aria-hidden="true" />
                        )}
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
              </DialogContent>
            </Dialog>
          ) : null}
        </ItemFooter>
      ) : null}
    </Item>
  );
}
