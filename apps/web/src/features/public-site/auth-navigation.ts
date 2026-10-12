export const authenticationPaths = ["/login", "/signup", "/forgot-password"] as const;

export function isAuthenticationPath(path: string): boolean {
  return authenticationPaths.some((candidate) => candidate === path.replace(/\/$/, ""));
}

/** Only return to a local application destination, never another origin or an auth loop. */
export function authenticationDestination(search: string): string {
  const next = new URLSearchParams(search).get("next");
  if (
    !next ||
    !next.startsWith("/") ||
    next.startsWith("//") ||
    next.includes("\\") ||
    Array.from(next).some((character) => character.charCodeAt(0) < 32)
  ) {
    return "/today";
  }
  const url = new URL(next, "https://nohmi.invalid");
  if (
    url.pathname.startsWith("//") ||
    url.pathname === "/" ||
    isAuthenticationPath(url.pathname.replace(/\/$/, ""))
  )
    return "/today";
  return `${url.pathname}${url.search}${url.hash}`;
}
