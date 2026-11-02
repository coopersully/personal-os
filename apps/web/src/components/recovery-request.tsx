import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { toast, useSonner } from "sonner";
import { ModalRecoveryPriority } from "./modal-recovery-priority";
import { RecoverySurface } from "./recovery-surface";

type Request = Omit<Parameters<typeof RecoverySurface>[0], "open"> & {
  toastId?: string | undefined;
};
const RecoveryRequests = createContext<((id: string, request: Request | null) => void) | null>(
  null,
);

/** Domain recovery retains its own draft/actions; the shell presents just one interruption. */
export function RecoveryQueue({ children }: { children: ReactNode }) {
  const blocked = useContext(ModalRecoveryPriority);
  const { toasts } = useSonner();
  const [requests, setRequests] = useState<Map<string, Request>>(() => new Map());
  const register = useCallback((id: string, request: Request | null) => {
    setRequests((previous) => {
      if (!request && !previous.has(id)) return previous;
      const next = new Map(previous);
      if (request) next.set(id, request);
      else next.delete(id);
      return next;
    });
  }, []);
  // Sonner publishes asynchronously. Observe from the session root, before an error exists,
  // so a late toast cannot reappear after its domain dialog has taken ownership.
  useEffect(() => {
    const owned = new Set([...requests.values()].map((request) => request.toastId).filter(Boolean));
    for (const message of toasts) if (owned.has(String(message.id))) toast.dismiss(message.id);
  }, [requests, toasts]);
  const current = requests.values().next().value;
  return (
    <RecoveryRequests.Provider value={register}>
      <ModalRecoveryPriority.Provider value={blocked || Boolean(current)}>
        {children}
        {current && !blocked ? <RecoverySurface open {...current} /> : null}
      </ModalRecoveryPriority.Provider>
    </RecoveryRequests.Provider>
  );
}

/** Registers an out-of-flow recovery surface without moving or unmounting its source. */
export function RecoveryRequest({
  open,
  title,
  description,
  children,
  actions,
  toastId,
}: Parameters<typeof RecoverySurface>[0] & { toastId?: string | undefined }) {
  useEffect(() => {
    // A decision surface replaces only its own initial announcement, never unrelated feedback.
    if (open && toastId) toast.dismiss(toastId);
  }, [open, toastId]);
  const register = useContext(RecoveryRequests);
  const blocked = useContext(ModalRecoveryPriority);
  const id = useId();
  const request = useMemo(
    () => ({ title, description, children, actions, toastId }),
    [title, description, children, actions, toastId],
  );
  useLayoutEffect(() => {
    register?.(id, open ? request : null);
  }, [register, id, open, request]);
  useLayoutEffect(() => () => register?.(id, null), [register, id]);
  return !register ? <RecoverySurface open={open && !blocked} {...request} /> : null;
}
