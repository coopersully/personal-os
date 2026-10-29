import type * as React from "react";

import { cn } from "@/lib/utils";
import { CardActionContext, CardSurfaceContext } from "./card-context";

function Card({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"div"> & { size?: "default" | "sm" }) {
  return (
    <CardSurfaceContext.Provider value={true}>
      <div
        data-slot="card"
        data-size={size}
        className={cn(
          "group/card flex min-w-0 flex-col gap-0 overflow-hidden rounded-xl border border-transparent bg-card py-0 text-sm text-card-foreground [--card-spacing:--spacing(4)] has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(3)] [&:has(>[data-slot=card-header])>[data-slot=card-content]]:pt-0 [&:has(>[data-slot=card-footer])>[data-slot=card-content]]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl",
          className,
        )}
        {...props}
      />
    </CardSurfaceContext.Provider>
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-xl p-(--card-spacing) has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto] has-data-[slot=card-description]:grid-rows-[auto_auto]",
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "font-heading text-base leading-snug font-medium group-data-[size=sm]/card:text-sm",
        className,
      )}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <CardActionContext.Provider value={true}>
      <div
        data-slot="card-action"
        className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)}
        {...props}
      />
    </CardActionContext.Provider>
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="card-content" className={cn("p-(--card-spacing)", className)} {...props} />
  );
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center rounded-b-xl p-(--card-spacing)",
        className,
      )}
      {...props}
    />
  );
}

export { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
