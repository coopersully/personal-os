import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const eventCardVariants = cva(
  "event-card group/event-card w-full min-w-0 max-w-full gap-0 overflow-hidden py-0 [contain:inline-size]",
  {
    variants: {
      tone: {
        calendar: "",
        default: "",
        inverse:
          "border-[var(--inverse-border-subtle)] bg-[var(--inverse-surface-raised)] text-[var(--inverse-content)]",
      },
    },
    defaultVariants: {
      tone: "default",
    },
  },
);

function EventCard({
  className,
  size = "sm",
  tone = "default",
  ...props
}: React.ComponentProps<typeof Card> & VariantProps<typeof eventCardVariants>) {
  return (
    <Card
      data-slot="event-card"
      data-tone={tone}
      size={size}
      className={cn(eventCardVariants({ tone }), className)}
      {...props}
    />
  );
}

function EventCardContent({ className, ...props }: React.ComponentProps<typeof CardContent>) {
  return (
    <CardContent
      data-slot="event-card-content"
      className={cn(
        "flex w-full min-w-0 max-w-full items-stretch gap-3 overflow-hidden py-3",
        className,
      )}
      {...props}
    />
  );
}

function EventCardTime({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="event-card-time"
      className={cn(
        "flex w-16 shrink-0 items-center whitespace-nowrap font-mono text-xs leading-none tabular-nums text-muted-foreground group-data-[tone=inverse]/event-card:text-[var(--inverse-content-tertiary)]",
        className,
      )}
      {...props}
    />
  );
}

function EventCardTitleMeta({ className, ...props }: React.ComponentProps<"small">) {
  return (
    <small
      data-slot="event-card-title-meta"
      className={cn(
        "shrink-0 text-xs leading-none font-normal text-muted-foreground group-data-[tone=inverse]/event-card:text-[var(--inverse-content-tertiary)]",
        className,
      )}
      {...props}
    />
  );
}

function EventCardIndicator({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      aria-hidden="true"
      data-slot="event-card-indicator"
      className={cn(
        "w-0.5 shrink-0 rounded-full bg-primary group-data-[tone=inverse]/event-card:bg-[var(--inverse-content-secondary)]",
        className,
      )}
      {...props}
    />
  );
}

function EventCardPrimaryAction({
  className,
  type = "button",
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      data-slot="event-card-primary-action"
      type={type}
      variant="ghost"
      className={cn(
        "group/event-card-action h-auto min-w-0 flex-1 justify-start overflow-hidden rounded-md px-0 py-0 text-left text-inherit hover:bg-transparent hover:text-inherit focus-visible:border-transparent active:translate-y-0",
        className,
      )}
      {...props}
    />
  );
}

function EventCardBody({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="event-card-body"
      className={cn(
        "flex min-w-0 flex-1 flex-col items-start justify-center gap-0.5 overflow-hidden",
        className,
      )}
      {...props}
    />
  );
}

function EventCardTitle({ className, ...props }: React.ComponentProps<"strong">) {
  return (
    <strong
      data-slot="event-card-title"
      className={cn(
        "flex w-full min-w-0 max-w-full items-center gap-1 overflow-hidden text-sm leading-snug font-medium",
        className,
      )}
      {...props}
    />
  );
}

function EventCardDescription({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="event-card-description"
      className={cn(
        "min-w-0 max-w-full truncate text-xs leading-normal text-muted-foreground group-data-[tone=inverse]/event-card:text-[var(--inverse-content-tertiary)]",
        className,
      )}
      {...props}
    />
  );
}

function EventCardAside({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="event-card-aside"
      className={cn(
        "flex shrink-0 items-center gap-2 self-center text-muted-foreground group-data-[tone=inverse]/event-card:text-[var(--inverse-content-secondary)] [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
}

function EventCardFooter({ className, ...props }: React.ComponentProps<typeof CardFooter>) {
  return (
    <CardFooter
      data-slot="event-card-footer"
      className={cn(
        "flex-wrap justify-between gap-2 py-2 group-data-[tone=inverse]/event-card:border-[var(--inverse-border)] group-data-[tone=inverse]/event-card:bg-[var(--inverse-border-subtle)]",
        className,
      )}
      {...props}
    />
  );
}

export {
  EventCard,
  EventCardAside,
  EventCardBody,
  EventCardContent,
  EventCardDescription,
  EventCardFooter,
  EventCardIndicator,
  EventCardPrimaryAction,
  EventCardTime,
  EventCardTitle,
  EventCardTitleMeta,
};
