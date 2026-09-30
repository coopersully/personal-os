import type * as React from "react";
import { useContext } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { WorkspaceSecondarySlotContext } from "./workspace-layout.js";

type WorkspaceSecondaryAppBarProps = Omit<React.ComponentProps<"nav">, "aria-label"> & {
  "aria-label": string;
  enabled?: boolean;
  /** Spatial headers stay inside their grid's scrolling coordinate system. */
  placement?: "layout" | "inline";
};

/**
 * Shared contextual chrome rendered immediately below the primary workspace
 * app bar. Features supply meaning and controls; this component owns the
 * landmark, slot order, surface, and responsive geometry.
 */
export function WorkspaceSecondaryAppBar({
  className,
  enabled = true,
  placement = "layout",
  ...props
}: WorkspaceSecondaryAppBarProps) {
  const target = useContext(WorkspaceSecondarySlotContext);
  if (!enabled) return null;
  const bar = (
    <nav
      className={cn("workspace-secondary-app-bar", className)}
      data-slot="workspace-secondary-app-bar"
      {...props}
    />
  );
  if (placement === "inline" || target === undefined) return bar;
  return target ? createPortal(bar, target) : null;
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
