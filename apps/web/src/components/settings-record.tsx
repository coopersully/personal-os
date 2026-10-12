import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type RecordContentProps = {
  title: ReactNode;
  description?: ReactNode;
  leading?: ReactNode;
  actions?: ReactNode;
  metadata?: ReactNode;
  children?: ReactNode;
};

/** Shared record anatomy, also used inside Motion's reorderable Item root. */
export function SettingsRecordContent({
  title,
  description,
  leading,
  actions,
  metadata,
  children,
}: RecordContentProps) {
  return (
    <ItemContent className="settings-record__content">
      <div className="settings-record__header">
        {leading ? <div className="settings-record__leading">{leading}</div> : null}
        <ItemTitle className="settings-record__title">{title}</ItemTitle>
        {actions ? <ItemActions className="settings-record__actions">{actions}</ItemActions> : null}
      </div>
      {description ? (
        <ItemDescription className="settings-record__description">{description}</ItemDescription>
      ) : null}
      {metadata ? <div className="settings-record__metadata">{metadata}</div> : null}
      {children}
    </ItemContent>
  );
}

export function SettingsRecord(props: RecordContentProps) {
  return (
    <Item variant="secondary" role="listitem" className="settings-record">
      <SettingsRecordContent {...props} />
    </Item>
  );
}

/** Every record action keeps the same target size, accessible name, and hover/focus help. */
export function SettingsRecordAction({
  label,
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, "size" | "variant"> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button {...props} type="button" aria-label={label} size="icon-sm" variant="ghost">
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
