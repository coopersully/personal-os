import type { ComponentProps, ReactNode } from "react";
import { LinkOffIcon } from "@/components/icons";
import { Avatar, AvatarFallback, AvatarGroup, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface AccountSelectionIdentity {
  avatarUrl?: string | null | undefined;
  fallback: string;
  id: string;
}

type AccountSelectionTriggerProps = Omit<
  ComponentProps<typeof Button>,
  "aria-label" | "children"
> & {
  ariaLabel: string;
  identities: AccountSelectionIdentity[];
  needsAttention?: boolean;
  selectedCount: number;
  totalCount: number;
};

export function AccountSelectionTrigger({
  ariaLabel,
  className,
  disabled,
  identities,
  needsAttention = false,
  selectedCount,
  totalCount,
  ...buttonProps
}: AccountSelectionTriggerProps) {
  return (
    <Button
      {...buttonProps}
      aria-label={ariaLabel}
      className={cn("account-selection-trigger", className)}
      disabled={disabled}
      size="sm"
      variant="ghost"
    >
      {needsAttention ? (
        <LinkOffIcon
          aria-hidden="true"
          className="account-selection-trigger__warning"
          weight="Filled"
        />
      ) : null}
      <AvatarGroup className="account-selection-trigger__avatars">
        {identities.map((identity) => (
          <Avatar key={identity.id} size="sm">
            {identity.avatarUrl ? <AvatarImage alt="" src={identity.avatarUrl} /> : null}
            <AvatarFallback>{identity.fallback}</AvatarFallback>
          </Avatar>
        ))}
      </AvatarGroup>
      <span aria-hidden="true" className="account-selection-trigger__count">
        {selectedCount}/{totalCount} accounts
      </span>
    </Button>
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
