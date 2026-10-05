import type { ComponentProps } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

type SingleGroupProps = Extract<ComponentProps<typeof ToggleGroup>, { type: "single" }>;

/** A compact, required single selection. Feature code owns the selected value. */
export function SegmentedControl({
  className,
  onValueChange,
  ...props
}: Omit<
  SingleGroupProps,
  "type" | "variant" | "size" | "spacing" | "orientation" | "defaultValue"
> & {
  value: string;
  "aria-label": string;
}) {
  return (
    <ToggleGroup
      {...props}
      className={cn("segmented-control", className)}
      type="single"
      variant="default"
      size="sm"
      spacing={1}
      orientation="horizontal"
      onValueChange={(value) => {
        if (value) onValueChange?.(value);
      }}
    />
  );
}

export const SegmentedControlItem = ToggleGroupItem;
