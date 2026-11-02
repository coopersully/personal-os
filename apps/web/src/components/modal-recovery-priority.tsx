import { createContext, useContext, useLayoutEffect, useRef, useState } from "react";

export const ModalRecoveryPriority = createContext(false);

/** Queue new overlays during recovery, preserving already-open editors and their drafts. */
export function useModalRecoveryPriority({
  open,
  defaultOpen = false,
  onOpenChange,
}: {
  open?: boolean | undefined;
  defaultOpen?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
}) {
  const blocked = useContext(ModalRecoveryPriority);
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const presented = useRef(false);
  const effectiveOpen = (open ?? uncontrolled) && (!blocked || presented.current);
  useLayoutEffect(() => {
    presented.current = effectiveOpen;
  }, [effectiveOpen]);
  return {
    open: effectiveOpen,
    onOpenChange: (next: boolean) => {
      setUncontrolled(next);
      onOpenChange?.(next);
    },
  };
}
