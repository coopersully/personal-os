import type * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { cn } from "@/lib/utils";

function CommitmentItem({ className, ...props }: React.ComponentProps<typeof Item>) {
  return (
    <Item
      data-slot="commitment-item"
      role="listitem"
      variant="outline"
      className={cn(
        "group/commitment-item min-h-13 items-start gap-x-2.5 gap-y-2 px-3 py-2.5 sm:items-center [&[data-completed=true]]:opacity-65",
        className,
      )}
      {...props}
    />
  );
}

function CommitmentItemCompletion({ className, ...props }: React.ComponentProps<typeof ItemMedia>) {
  return (
    <ItemMedia
      data-slot="commitment-item-completion"
      className={cn("self-start pt-0.5 sm:self-center sm:pt-0", className)}
      {...props}
    />
  );
}

function CommitmentItemPrimaryAction({
  className,
  type = "button",
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      data-slot="commitment-item-primary-action"
      type={type}
      variant="ghost"
      className={cn(
        "h-auto min-h-0 min-w-0 flex-1 justify-start rounded-md px-0 py-0 text-left text-inherit hover:bg-transparent hover:text-inherit focus-visible:border-transparent active:translate-y-0",
        className,
      )}
      {...props}
    />
  );
}

function CommitmentItemContent({ className, ...props }: React.ComponentProps<typeof ItemContent>) {
  return (
    <ItemContent
      data-slot="commitment-item-content"
      className={cn("min-w-0", className)}
      {...props}
    />
  );
}

function CommitmentItemTitle({ className, ...props }: React.ComponentProps<typeof ItemTitle>) {
  return (
    <ItemTitle
      data-slot="commitment-item-title"
      className={cn(
        "w-full text-left group-hover/commitment-item:underline group-focus-within/commitment-item:underline group-data-[completed=true]/commitment-item:line-through group-data-[completed=true]/commitment-item:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function CommitmentItemDescription({
  className,
  ...props
}: React.ComponentProps<typeof ItemDescription>) {
  return (
    <ItemDescription data-slot="commitment-item-description" className={className} {...props} />
  );
}

function CommitmentItemMetadata({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="commitment-item-metadata"
      className={cn("flex shrink-0 flex-wrap items-center gap-1.5 self-center", className)}
      {...props}
    />
  );
}

function CommitmentItemTags({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="commitment-item-tags"
      className={cn("order-last flex basis-full flex-wrap gap-1 pl-7 sm:pl-0", className)}
      {...props}
    />
  );
}

function CommitmentItemActions({ className, ...props }: React.ComponentProps<typeof ItemActions>) {
  return (
    <ItemActions
      data-slot="commitment-item-actions"
      className={cn("self-center", className)}
      {...props}
    />
  );
}

export {
  CommitmentItem,
  CommitmentItemActions,
  CommitmentItemCompletion,
  CommitmentItemContent,
  CommitmentItemDescription,
  CommitmentItemMetadata,
  CommitmentItemPrimaryAction,
  CommitmentItemTags,
  CommitmentItemTitle,
};
