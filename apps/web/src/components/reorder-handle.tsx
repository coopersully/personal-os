import type { DragControls } from "motion/react";
import { MenuIcon } from "./icons";
import { Button } from "./ui/button";

/** Reordering is handle-only; text, inputs, and row actions stay interactive. */
export function ReorderHandle({
  controls,
  label,
  onMove,
  canMoveUp = true,
  canMoveDown = true,
}: {
  controls: DragControls;
  label: string;
  onMove: (offset: number) => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="shrink-0 cursor-grab touch-none active:cursor-grabbing"
      data-vaul-no-drag
      aria-label={label}
      aria-description="Drag to reorder or use the up and down arrow keys"
      onPointerDown={(event) => controls.start(event)}
      onKeyDown={(event) => {
        const offset = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
        if (!offset) return;
        event.preventDefault();
        if ((offset < 0 && canMoveUp) || (offset > 0 && canMoveDown)) onMove(offset);
      }}
    >
      <MenuIcon />
    </Button>
  );
}
