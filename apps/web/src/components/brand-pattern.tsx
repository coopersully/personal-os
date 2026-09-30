import { type CSSProperties, useState } from "react";
import { NohmiBrandMark } from "@/components/brand-marks";
import { cn } from "@/lib/utils";

/** Decorative only: timings stay stable when surrounding UI changes. */
export function BrandPattern({ fullScreen = false }: { fullScreen?: boolean }) {
  const [tiles] = useState(() =>
    Array.from({ length: fullScreen ? 80 : 48 }, (_, id) => ({
      id,
      style: {
        "--tile-opacity": 0.1 + Math.random() * 0.08,
        "--tile-peak": 0.28 + Math.random() * 0.12,
        animationDelay: `${-Math.random() * 12}s`,
        animationDuration: `${6 + Math.random() * 6}s`,
      } as CSSProperties,
    })),
  );

  return (
    <div aria-hidden="true" className={cn("brand-pattern", fullScreen && "brand-pattern--page")}>
      {tiles.map((tile) => (
        <span className="brand-pattern__tile" key={tile.id} style={tile.style}>
          <NohmiBrandMark symbol />
        </span>
      ))}
    </div>
  );
}
