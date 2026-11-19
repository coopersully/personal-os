import { mobileAppOrigin } from "../features/auth/context";
import { redirectLink } from "../features/links/intent";

export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  return redirectLink(path, initial, mobileAppOrigin);
}
