import type { ComponentProps, ReactNode } from "react";
import type { ActionButton as Button } from "@/components/action-button";
import {
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { FilterTrigger } from "./data-view-controls";

type AccountSelectionTriggerProps = Omit<
  ComponentProps<typeof Button>,
  "aria-label" | "children"
> & {
  ariaLabel: string;
  needsAttention?: boolean;
  allSynced?: boolean;
  selectedCount: number;
  totalCount: number;
};

export function AccountSelectionTrigger({
  ariaLabel,
  className,
  disabled,
  needsAttention = false,
  allSynced = false,
  selectedCount,
  totalCount,
  variant: _variant,
  tooltip,
  ...buttonProps
}: AccountSelectionTriggerProps) {
  return (
    <FilterTrigger
      {...buttonProps}
      aria-label={ariaLabel}
      tooltip={
        tooltip ??
        `${ariaLabel}${allSynced && !needsAttention ? ", all accounts connected and syncing" : ""}`
      }
      className={cn("account-selection-trigger", className)}
      disabled={disabled}
      size="sm"
      active={selectedCount !== totalCount}
      label={
        <span aria-hidden="true" className="tabular-nums">
          {selectedCount}
        </span>
      }
    />
  );
}

type AccountSelectionPopoverContentProps = Omit<
  ComponentProps<typeof PopoverContent>,
  "children" | "title"
> & {
  children: ReactNode;
  description: ReactNode;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
  title: ReactNode;
};

export function AccountSelectionPopoverContent({
  children,
  className,
  description,
  primaryAction,
  secondaryAction,
  title,
  ...contentProps
}: AccountSelectionPopoverContentProps) {
  return (
    <PopoverContent
      align="end"
      className={cn("account-selection-popover", className)}
      collisionPadding={8}
      sideOffset={8}
      {...contentProps}
    >
      <PopoverHeader>
        <PopoverTitle>{title}</PopoverTitle>
        <PopoverDescription>{description}</PopoverDescription>
      </PopoverHeader>
      {children}
      {primaryAction || secondaryAction ? (
        <div className="account-selection-popover__actions">
          {secondaryAction}
          {primaryAction}
        </div>
      ) : null}
    </PopoverContent>
  );
}

export function reconnectAccountsLabel(count: number) {
  return `Reconnect ${count} ${count === 1 ? "account" : "accounts"}`;
}
