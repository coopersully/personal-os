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
      data-component="commitment-item"
      data-slot="commitment-item"
      role="listitem"
      variant="outline"
      className={cn(
        "group/commitment-item relative min-h-12 items-start gap-x-2 gap-y-1 rounded-md px-2.5 py-2 [&[data-completed=true]]:opacity-65",
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
      className={cn("self-start pt-0.5", className)}
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
        "h-auto min-h-0 min-w-0 flex-1 items-start justify-start rounded-md px-0 py-0 text-left text-inherit whitespace-normal hover:bg-transparent hover:text-inherit focus-visible:border-transparent active:translate-y-0",
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
      className={cn("min-w-0 gap-1", className)}
      {...props}
    />
  );
}

function CommitmentItemTitle({ className, ...props }: React.ComponentProps<typeof ItemTitle>) {
  return (
    <ItemTitle
      data-slot="commitment-item-title"
      className={cn(
        "line-clamp-2 w-full text-left text-[0.9375rem] leading-5 group-hover/commitment-item:underline group-focus-within/commitment-item:underline group-data-[completed=true]/commitment-item:line-through group-data-[completed=true]/commitment-item:text-muted-foreground",
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
    <ItemDescription
      data-slot="commitment-item-description"
      className={cn("line-clamp-2 text-xs leading-4", className)}
      {...props}
    />
  );
}

function CommitmentItemDue({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="commitment-item-due"
      className={cn(
        "line-clamp-1 flex w-full items-center gap-1 text-[0.6875rem] leading-4 font-medium text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function CommitmentItemMetadata({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="commitment-item-metadata"
      className={cn("flex shrink-0 flex-wrap items-center gap-1.5 self-start pt-0.5", className)}
      {...props}
    />
  );
}

function CommitmentItemTags({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="commitment-item-tags"
      className={cn("mt-1 flex flex-wrap gap-1", className)}
      {...props}
    />
  );
}

function CommitmentItemActions({ className, ...props }: React.ComponentProps<typeof ItemActions>) {
  return (
    <ItemActions
      data-slot="commitment-item-actions"
      className={cn(
        "absolute right-1.5 bottom-1 opacity-0 transition-opacity group-hover/commitment-item:opacity-100 group-focus-within/commitment-item:opacity-100 [@media(hover:none)]:opacity-100",
        className,
      )}
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
  CommitmentItemDue,
  CommitmentItemMetadata,
  CommitmentItemPrimaryAction,
  CommitmentItemTags,
  CommitmentItemTitle,
};
