import type { ReactNode } from "react";
import { FireIcon } from "../../components/icons.js";

/** Shared hierarchy for decisions that interrupt a ritual. */
export function RitualEscapeSummary({
  streak,
  children,
}: {
  streak: number | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex max-w-md flex-col items-center gap-5">
      <h2
        className="flex flex-col items-center gap-2"
        aria-label={
          streak === undefined ? "Current streak unavailable" : `${streak}-day current streak`
        }
      >
        <span className="flex items-center gap-3 text-6xl font-semibold tabular-nums tracking-tight">
          <FireIcon aria-hidden="true" className="size-10 opacity-70" />
          {streak ?? "—"}
        </span>
        <span className="text-sm font-normal opacity-65">
          {streak === 1 ? "day in a row" : "days in a row"}
        </span>
      </h2>
      <p className="text-sm leading-relaxed opacity-75">{children}</p>
    </div>
  );
}
