import { type ComponentProps, isValidElement } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Icon actions retain their accessible name and expose it on hover and keyboard focus. */
export function ActionButton({
  tooltip,
  badgeCount,
  ...props
}: ComponentProps<typeof Button> & { tooltip?: string; badgeCount?: number }) {
  if (badgeCount && badgeCount > 0 && !props.asChild) {
    props = {
      ...props,
      className: cn(props.className, "action-count-trigger relative"),
      children: (
        <>
          {props.children}
          <Badge aria-hidden="true" className="action-count-badge">
            {badgeCount}
          </Badge>
        </>
      ),
    };
  }
  const childLabel = isValidElement<{ "aria-label"?: string }>(props.children)
    ? props.children.props["aria-label"]
    : undefined;
  const label = tooltip ?? props.title ?? props["aria-label"] ?? childLabel;
  if ((!props.size?.startsWith("icon") && !tooltip) || !label) return <Button {...props} />;
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button {...props} aria-label={props["aria-label"] ?? label} title={undefined} />
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6} className="action-tooltip pointer-events-none">
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
