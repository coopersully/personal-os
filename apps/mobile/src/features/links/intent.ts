import { isHandoffLink, isWebLink, nativeLink } from "./parse";
import { offerLink } from "./pending";

/**
 * Handles a URL the system handed to the app. A web link (Universal Link) is never routed by its
 * web path: it is validated, queued for the signed-in shell, and the app starts on Today or stays
 * where it is. A return link for an open flow is dropped here. Custom-scheme paths keep the
 * router's own handling.
 */
export function redirectLink(path: string, initial: boolean, appOrigin: string): string | null {
  if (!isWebLink(path)) return path;
  // A return link belongs to the flow that is already open; its parameters go no further.
  if (!isHandoffLink(path, appOrigin))
    offerLink(nativeLink(path, appOrigin) ?? { kind: "unsupported" });
  return initial ? "/" : null;
}
