import type { ReactNode } from "react";

/** Reserve the same frame footprint for artwork with and without a visible tile. */
export function SettingsIconSlot({ children }: { children: ReactNode }) {
  return (
    <span className="settings-icon-slot" aria-hidden="true">
      {children}
    </span>
  );
}
