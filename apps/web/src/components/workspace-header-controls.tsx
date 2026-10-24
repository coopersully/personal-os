import { type ReactNode, useContext } from "react";
import { createPortal } from "react-dom";
import { WorkspaceHeaderSlotContext } from "./workspace-layout.js";

/** Route-owned controls retain their state while the shell owns their placement. */
export function WorkspaceHeaderControls({
  children,
  label,
  placement = "actions",
}: {
  children: ReactNode;
  label: string;
  placement?: "title" | "leading" | "actions";
}) {
  const slot = useContext(WorkspaceHeaderSlotContext);
  const controls = (
    <fieldset aria-label={label} className="workspace-header-controls">
      {children}
    </fieldset>
  );
  if (slot === undefined) return controls;
  const target =
    placement === "title"
      ? slot.titleTarget
      : placement === "leading"
        ? slot.leadingTarget
        : slot.target;
  return target ? createPortal(controls, target) : null;
}

export function WorkspaceHeaderControlsSlot({
  placement = "actions",
}: {
  placement?: "title" | "leading" | "actions";
}) {
  const slot = useContext(WorkspaceHeaderSlotContext);
  return (
    <div
      className={
        placement === "title"
          ? "workspace-header-title-context"
          : placement === "leading"
            ? "workspace-header-controls-slot workspace-header-controls-slot--leading flex flex-wrap items-center gap-1.5"
            : "workspace-header-controls-slot flex flex-wrap items-center gap-1.5"
      }
      data-slot="workspace-header-controls"
      ref={
        placement === "title"
          ? slot?.setTitleTarget
          : placement === "leading"
            ? slot?.setLeadingTarget
            : slot?.setTarget
      }
    />
  );
}
