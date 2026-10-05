import { type CSSProperties, useState } from "react";
import { NohmiBrandMark } from "@/components/brand-marks";
import { cn } from "@/lib/utils";

/** Decorative only: timings stay stable when surrounding UI changes. */
export function BrandPattern({
  fullScreen = false,
  profile = false,
}: {
  fullScreen?: boolean;
  profile?: boolean;
}) {
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
    <div
      aria-hidden="true"
      className={cn(
        "brand-pattern",
        fullScreen && "brand-pattern--page",
        profile && "brand-pattern--profile",
      )}
    >
      {tiles.map((tile) => (
        <span
          className="brand-pattern__tile"
          key={tile.id}
          style={
            profile
              ? ({
                  ...tile.style,
                  "--tile-opacity":
                    Number(tile.style["--tile-opacity" as keyof CSSProperties]) *
                    ((tile.id % 8) / 7) ** 1.6 *
                    (0.1 + (0.9 * Math.floor(tile.id / 8)) / 5),
                  "--tile-peak":
                    Number(tile.style["--tile-peak" as keyof CSSProperties]) *
                    ((tile.id % 8) / 7) ** 1.6 *
                    (0.1 + (0.9 * Math.floor(tile.id / 8)) / 5),
                } as CSSProperties)
              : tile.style
          }
        >
          <NohmiBrandMark symbol />
        </span>
      ))}
    </div>
  );
}
