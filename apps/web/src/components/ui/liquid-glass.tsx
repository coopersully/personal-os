import { createContext, type ReactNode, type ComponentProps, useContext, useState, useEffect } from "react";
import GlassSurface, { type GlassSurfaceBackdrop } from "./react-bits/GlassSurface";

const ignoreBackdrop = (_backdrop: GlassSurfaceBackdrop | null) => {};
const LiquidGlassContext = createContext({ enabled: false, backdrop: null as GlassSurfaceBackdrop | null, setBackdrop: ignoreBackdrop });

/** Opt a region's cards into one material and share a local optical backdrop. */
export function LiquidGlassProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [backdrop, setBackdrop] = useState<GlassSurfaceBackdrop | null>(null);
  return <LiquidGlassContext.Provider value={{ enabled, backdrop, setBackdrop }}>{children}</LiquidGlassContext.Provider>;
}
export const useLiquidGlass = () => useContext(LiquidGlassContext).enabled;
export const useMaterialBackdrop = () => useContext(LiquidGlassContext).setBackdrop;

/** Decorative only: content and interaction remain on the original surface. */
export function LiquidGlassMaterial() {
  const { backdrop } = useContext(LiquidGlassContext);
  const [opaque, setOpaque] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active)");
    const update = () => setOpaque(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return (
    <div className="material-liquid__layer" aria-hidden="true">
      {!opaque && <GlassSurface width="100%" height="100%" borderRadius={14} backgroundOpacity={0.18}
        backdrop={backdrop} distortionScale={-40} redOffset={0} greenOffset={2} blueOffset={4}
        saturation={1.1} blur={11} displace={8} />}
    </div>
  );
}
export function LiquidGlassScope({ enabled, children, ...props }: ComponentProps<"div"> & { enabled: boolean }) {
  return <LiquidGlassProvider enabled={enabled}><div {...props}>{children}</div></LiquidGlassProvider>;
}
