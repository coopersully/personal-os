import { SideProfileIcon } from "@/components/icons";

/**
 * The ilo application mark. The `.logo-mark` class supplies the rounded-square frame, so the glyph
 * itself renders unframed here. It uses the Filled weight to match the raster mark assets, which
 * cannot carry an outline legibly at favicon and browser-tab sizes.
 */
export function LogoMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`logo-mark${compact ? " logo-mark--compact" : ""}`}>
      <SideProfileIcon aria-hidden="true" weight="Filled" />
    </span>
  );
}
