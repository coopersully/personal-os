import type * as React from "react";
import { cn } from "@/lib/utils";

type WorkspaceSecondaryAppBarProps = Omit<React.ComponentProps<"nav">, "aria-label"> & {
  "aria-label": string;
};

/**
 * Shared contextual chrome rendered immediately below the primary workspace
 * app bar. Features supply meaning and controls; this component owns the
 * landmark, slot order, surface, and responsive geometry.
 */
export function WorkspaceSecondaryAppBar({ className, ...props }: WorkspaceSecondaryAppBarProps) {
  return (
    <nav
      className={cn("workspace-secondary-app-bar", className)}
      data-slot="workspace-secondary-app-bar"
      {...props}
    />
  );
}

export function WorkspaceSecondaryAppBarLeading({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("workspace-secondary-app-bar__leading", className)}
      data-slot="workspace-secondary-app-bar-leading"
      {...props}
    />
  );
}

export function WorkspaceSecondaryAppBarContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("workspace-secondary-app-bar__content", className)}
      data-slot="workspace-secondary-app-bar-content"
      {...props}
    />
  );
}

export function WorkspaceSecondaryAppBarActions({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("workspace-secondary-app-bar__actions", className)}
      data-slot="workspace-secondary-app-bar-actions"
      {...props}
    />
  );
}
