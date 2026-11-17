import { isWebLink, nativeLink } from "./parse";
import { offerLink } from "./pending";

/**
 * Handles a URL the system handed to the app. A web link (Universal Link) is never routed by its
 * web path: it is validated, queued for the signed-in shell, and the app starts on Today or stays
 * where it is. Custom-scheme paths keep the router's own handling.
 */
export function redirectLink(path: string, initial: boolean, appOrigin: string): string | null {
  if (!isWebLink(path)) return path;
  offerLink(nativeLink(path, appOrigin) ?? { kind: "unsupported" });
  return initial ? "/" : null;
}
