import type { NativeLink } from "./parse";

/**
 * One link waiting to be opened. A link can arrive before the session is restored or while the
 * user is signed out, so it is held here until the signed-in shell takes it. Memory only.
 */
let pending: NativeLink | null = null;
const listeners = new Set<() => void>();
const changed = () => {
  for (const listener of listeners) listener();
};

/** A newer link replaces an older one that was never opened. */
export function offerLink(link: NativeLink) {
  pending = link;
  changed();
}
export const pendingLink = () => pending;
export function takeLink() {
  const link = pending;
  pending = null;
  if (link) changed();
  return link;
}
export function subscribeToLinks(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
